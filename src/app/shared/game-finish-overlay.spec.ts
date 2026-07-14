import { ComponentFixture, TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import { GameFinishConfettiService, GameFinishOverlayComponent } from './game-finish-overlay';

describe('GameFinishOverlayComponent', () => {
  let fixture: ComponentFixture<GameFinishOverlayComponent>;
  let component: GameFinishOverlayComponent;
  let confettiLauncher: ReturnType<typeof vi.fn> & { reset: ReturnType<typeof vi.fn> };
  let confettiService: { create: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    vi.useFakeTimers();
    confettiLauncher = vi.fn() as ReturnType<typeof vi.fn> & { reset: ReturnType<typeof vi.fn> };
    confettiLauncher.reset = vi.fn();
    confettiService = { create: vi.fn(() => Promise.resolve(confettiLauncher)) };
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({ matches: false }) as MediaQueryList)
    });

    await TestBed.configureTestingModule({
      declarations: [GameFinishOverlayComponent],
      providers: [{ provide: GameFinishConfettiService, useValue: confettiService }]
    }).compileComponents();

    fixture = TestBed.createComponent(GameFinishOverlayComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('title', 'You did it!');
    fixture.detectChanges();
    await fixture.whenStable();
    await Promise.resolve();
  });

  afterEach(() => {
    fixture.destroy();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('renders a victory card without clipping confetti to an overlay canvas', () => {
    const host: HTMLElement = fixture.nativeElement;

    expect(host.querySelector('.game-finish-confetti-canvas')).toBeFalsy();
    expect(host.querySelector('.game-finish-card')).toBeTruthy();
    expect(host.querySelector('.game-finish-crown')).toBeTruthy();
    expect(host.querySelector('.game-finish-title')?.textContent?.trim()).toBe('You did it!');
  });

  it('starts with a celebration burst and repeats every three seconds until closed', () => {
    expect(confettiService.create).toHaveBeenCalled();
    expect(confettiLauncher).toHaveBeenCalledTimes(3);
    const firstBurst = confettiLauncher.mock.calls[0][0] as any;
    expect(firstBurst.particleCount).toBe(420);
    expect(firstBurst.spread).toBe(118);
    expect(firstBurst.origin).toEqual({ x: 0.5, y: 0.58 });
    expect(firstBurst.zIndex).toBe(2147483647);

    vi.advanceTimersByTime(1000);

    expect(confettiLauncher).toHaveBeenCalledTimes(3);

    vi.advanceTimersByTime(2000);

    expect(confettiLauncher).toHaveBeenCalledTimes(4);
  });

  it('keeps the full celebration running even when reduced motion is enabled', async () => {
    fixture.destroy();
    confettiService.create.mockClear();
    confettiLauncher.mockClear();
    confettiLauncher.reset.mockClear();
    (window.matchMedia as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ matches: true } as MediaQueryList);

    fixture = TestBed.createComponent(GameFinishOverlayComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('title', 'You did it!');
    fixture.detectChanges();
    await fixture.whenStable();
    await Promise.resolve();

    expect(confettiService.create).toHaveBeenCalled();
    expect(confettiLauncher).toHaveBeenCalledTimes(3);

    vi.advanceTimersByTime(3000);

    expect(confettiLauncher).toHaveBeenCalledTimes(4);
  });

  it('resets confetti before emitting play again', () => {
    const playAgainSpy = jasmine.createSpy('playAgain');
    component.playAgain.subscribe(playAgainSpy);

    component.onPlayAgain();

    expect(confettiLauncher.reset).toHaveBeenCalled();
    expect(playAgainSpy).toHaveBeenCalled();
  });
});
