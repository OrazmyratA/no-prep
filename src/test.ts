import 'fake-indexeddb/auto';

import { CUSTOM_ELEMENTS_SCHEMA, NO_ERRORS_SCHEMA, Pipe, PipeTransform } from '@angular/core';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { expect, vi } from 'vitest';

class TestResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

function installMediaElementShims(): void {
  Object.defineProperty(HTMLMediaElement.prototype, 'load', {
    configurable: true,
    value: vi.fn()
  });
  Object.defineProperty(HTMLMediaElement.prototype, 'pause', {
    configurable: true,
    value: vi.fn()
  });
  Object.defineProperty(HTMLMediaElement.prototype, 'play', {
    configurable: true,
    value: vi.fn(() => Promise.resolve())
  });
}

@Pipe({
  name: 'translate',
  standalone: true
})
class TestTranslatePipe implements PipeTransform {
  transform(key: string): string {
    return key;
  }
}

type SpyWithJasmineApi = ReturnType<typeof vi.fn> & {
  and: {
    returnValue: (value: unknown) => SpyWithJasmineApi;
    callFake: (fn: (...args: unknown[]) => unknown) => SpyWithJasmineApi;
    resolveTo: (value: unknown) => SpyWithJasmineApi;
  };
};

function withJasmineApi(spy: ReturnType<typeof vi.fn>): SpyWithJasmineApi {
  const wrapped = spy as SpyWithJasmineApi;
  wrapped.and = {
    returnValue: (value: unknown) => {
      wrapped.mockReturnValue(value);
      return wrapped;
    },
    callFake: (fn: (...args: unknown[]) => unknown) => {
      wrapped.mockImplementation(fn);
      return wrapped;
    },
    resolveTo: (value: unknown) => {
      wrapped.mockResolvedValue(value);
      return wrapped;
    }
  };
  return wrapped;
}

function installJasmineCompat(): void {
  const globalScope = globalThis as typeof globalThis & {
    jasmine?: unknown;
    spyOn?: (target: Record<string, unknown>, method: string) => SpyWithJasmineApi;
  };

  (globalScope as any).jasmine = {
    createSpy: (name?: string) => withJasmineApi(vi.fn().mockName(name || 'spy')),
    createSpyObj: (_name: string, methods: readonly string[] | Record<string, unknown>) => {
      const result: Record<string, unknown> = {};
      const methodNames = Array.isArray(methods) ? methods : Object.keys(methods);
      for (const method of methodNames) {
        result[method] = withJasmineApi(vi.fn().mockName(method));
      }
      if (_name === 'LanguageService') {
        result['currentLang$'] = of('en');
      }
      return result;
    }
  };

  (globalScope as any).spyOn = (target: Record<string, unknown>, method: string) => {
    const spy = vi.spyOn(target, method as never) as unknown as ReturnType<typeof vi.fn>;
    return withJasmineApi(spy);
  };
}

function installJasmineMatchers(): void {
  expect.extend({
    toBeTrue(received: unknown) {
      return {
        pass: received === true,
        message: () => `expected ${String(received)} to be true`
      };
    },
    toBeFalse(received: unknown) {
      return {
        pass: received === false,
        message: () => `expected ${String(received)} to be false`
      };
    }
  });
}

function installDefaultAngularTestImports(): void {
  const originalConfigureTestingModule = TestBed.configureTestingModule.bind(TestBed);
  TestBed.configureTestingModule = ((metadata = {}) => {
    const declarations = [...(metadata.declarations || [])];
    const imports = [...(metadata.imports || [])];
    const providers = [...(metadata.providers || [])];
    const schemas = [...(metadata.schemas || [])];
    const hasTranslateDeclaration = declarations.some((item: unknown) => {
      const name = typeof item === 'function' ? item.name : '';
      return name === 'TranslatePipe' || name === 'TranslatePipeStub';
    });

    if (!hasTranslateDeclaration) {
      imports.push(TestTranslatePipe);
    }

    imports.push(FormsModule, ReactiveFormsModule);
    providers.push(
      provideRouter([]),
      {
        provide: ActivatedRoute,
        useValue: {
          snapshot: {
            paramMap: convertToParamMap({ id: '1', topicId: '1' }),
            queryParamMap: convertToParamMap({}),
            params: { id: '1', topicId: '1' },
            queryParams: {}
          },
          paramMap: of(convertToParamMap({ id: '1', topicId: '1' })),
          queryParamMap: of(convertToParamMap({})),
          params: of({ id: '1', topicId: '1' }),
          queryParams: of({})
        }
      }
    );
    schemas.push(CUSTOM_ELEMENTS_SCHEMA, NO_ERRORS_SCHEMA);

    return originalConfigureTestingModule({
      ...metadata,
      declarations,
      imports,
      providers,
      schemas
    });
  }) as typeof TestBed.configureTestingModule;
}

installJasmineCompat();
installJasmineMatchers();
installDefaultAngularTestImports();
installMediaElementShims();

(globalThis as typeof globalThis & { ResizeObserver?: typeof TestResizeObserver }).ResizeObserver ??= TestResizeObserver;
