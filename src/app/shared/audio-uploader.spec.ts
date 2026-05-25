import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AudioUploaderComponent } from './audio-uploader';

describe('AudioUploaderComponent', () => {
  let component: AudioUploaderComponent;
  let fixture: ComponentFixture<AudioUploaderComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [AudioUploaderComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(AudioUploaderComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
