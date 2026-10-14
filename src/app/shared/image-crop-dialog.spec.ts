import { ImageCropDialogComponent } from './image-crop-dialog';

// No TestBed/template rendering needed — the component has no injected dependencies, and these
// tests only exercise the pure drag/resize math plus the crop/cancel flow around it.
describe('ImageCropDialogComponent', () => {
  let component: ImageCropDialogComponent;

  function stubStage(width: number, height: number) {
    (component as any).stageRef = {
      nativeElement: { getBoundingClientRect: () => ({ width, height, left: 0, top: 0 }) }
    };
  }

  function pointerEvent(x: number, y: number, target: any = {}): PointerEvent {
    return { clientX: x, clientY: y, pointerId: 1, currentTarget: target, preventDefault: () => {} } as unknown as PointerEvent;
  }

  beforeEach(() => {
    component = new ImageCropDialogComponent();
    stubStage(200, 100);
  });

  it('loads a thumbnail per image and starts on the given index', () => {
    const blobs = [new Blob(['a']), new Blob(['b']), new Blob(['c'])];
    component.startIndex = 1;
    component.images = blobs;
    component.ngOnChanges({ images: {} as any });

    expect(component.thumbUrls.length).toBe(3);
    expect(component.activeIndex).toBe(1);
    expect(component.activeUrl).toBe(component.thumbUrls[1]);
  });

  it('clamps an out-of-range startIndex into range', () => {
    component.startIndex = 9;
    component.images = [new Blob(['a'])];
    component.ngOnChanges({ images: {} as any });
    expect(component.activeIndex).toBe(0);
  });

  it('resets the box to the default when switching pages', () => {
    component.images = [new Blob(['a']), new Blob(['b'])];
    component.ngOnChanges({ images: {} as any });
    component.box = { x: 0, y: 0, width: 0.3, height: 0.3 };
    component.setActiveIndex(1);
    expect(component.box).toEqual({ x: 0.1, y: 0.1, width: 0.8, height: 0.8 });
  });

  describe('dragging', () => {
    beforeEach(() => {
      component.box = { x: 0.2, y: 0.2, width: 0.4, height: 0.3 };
    });

    it('moves the box by the pointer delta as a fraction of the stage size', () => {
      const target = { setPointerCapture: () => {} };
      component.onHandleDown(pointerEvent(0, 0, target), 'move');
      // Stage is 200x100: 20px right = +0.1 fraction, 10px down = +0.1 fraction.
      component.onPointerMove(pointerEvent(20, 10));
      expect(component.box.x).toBeCloseTo(0.3, 5);
      expect(component.box.y).toBeCloseTo(0.3, 5);
      expect(component.box.width).toBeCloseTo(0.4, 5);
      expect(component.box.height).toBeCloseTo(0.3, 5);
    });

    it('does not let a move push the box past the right/bottom edge', () => {
      const target = { setPointerCapture: () => {} };
      component.onHandleDown(pointerEvent(0, 0, target), 'move');
      component.onPointerMove(pointerEvent(2000, 2000)); // huge drag, way off the right/bottom
      expect(component.box.x).toBeCloseTo(1 - 0.4, 5);
      expect(component.box.y).toBeCloseTo(1 - 0.3, 5);
    });

    it('resizes from the se handle without moving the top-left corner', () => {
      const target = { setPointerCapture: () => {} };
      component.onHandleDown(pointerEvent(0, 0, target), 'se');
      component.onPointerMove(pointerEvent(20, 10)); // +0.1 fraction right/down
      expect(component.box.x).toBeCloseTo(0.2, 5);
      expect(component.box.y).toBeCloseTo(0.2, 5);
      expect(component.box.width).toBeCloseTo(0.5, 5);
      expect(component.box.height).toBeCloseTo(0.4, 5);
    });

    it('resizes from the nw handle, moving the origin and shrinking size to match', () => {
      const target = { setPointerCapture: () => {} };
      component.onHandleDown(pointerEvent(0, 0, target), 'nw');
      component.onPointerMove(pointerEvent(20, 10)); // +0.1 fraction right/down shrinks from the top-left
      expect(component.box.x).toBeCloseTo(0.3, 5);
      expect(component.box.y).toBeCloseTo(0.3, 5);
      expect(component.box.width).toBeCloseTo(0.3, 5);
      expect(component.box.height).toBeCloseTo(0.2, 5);
    });

    it('never shrinks a resize below the minimum box size', () => {
      const target = { setPointerCapture: () => {} };
      component.onHandleDown(pointerEvent(0, 0, target), 'se');
      component.onPointerMove(pointerEvent(-2000, -2000)); // huge drag the other way
      expect(component.box.width).toBeCloseTo(0.05, 5);
      expect(component.box.height).toBeCloseTo(0.05, 5);
    });

    it('stops reacting to pointer moves once the pointer is released', () => {
      const target = { setPointerCapture: () => {} };
      component.onHandleDown(pointerEvent(0, 0, target), 'move');
      component.onPointerUp();
      const before = { ...component.box };
      component.onPointerMove(pointerEvent(50, 50));
      expect(component.box).toEqual(before);
    });
  });

  describe('confirm/cancel', () => {
    it('emits the cropped blob from the active image', async () => {
      const blob = new Blob(['cropped']);
      (component as any).cropToBlob = async () => blob;
      component.images = [new Blob(['a'])];
      component.ngOnChanges({ images: {} as any });

      const emitted: Blob[] = [];
      component.cropped.subscribe(b => emitted.push(b));
      await component.confirm();

      expect(emitted[0]).toBe(blob);
      expect(component.working).toBe(false);
    });

    it('does not emit cancelled while a crop is in progress', () => {
      component.working = true;
      let cancelled = false;
      component.cancelled.subscribe(() => (cancelled = true));
      component.cancel();
      expect(cancelled).toBe(false);
    });

    it('emits cancelled when not working', () => {
      let cancelled = false;
      component.cancelled.subscribe(() => (cancelled = true));
      component.cancel();
      expect(cancelled).toBe(true);
    });
  });
});
