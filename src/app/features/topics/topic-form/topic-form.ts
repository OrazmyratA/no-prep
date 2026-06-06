import { Component, OnInit } from '@angular/core';
import { FormArray, FormBuilder, FormGroup, Validators, ValidatorFn, AbstractControl } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { DbService } from '../../../core/db';
import { db, Item } from '../../../core/db.model'; // import db and Item
import { LicenseService } from '../../../core/license';

@Component({
  selector: 'app-topic-form',
  standalone: false,
  templateUrl: './topic-form.html',
  styleUrls: ['./topic-form.css']
})
export class TopicFormComponent implements OnInit {
  topicForm: FormGroup;
  isEdit = false;
  topicId?: number;
  private expandedImageItems = new WeakSet<AbstractControl>();
  private expandedAudioItems = new WeakSet<AbstractControl>();

  constructor(
    private fb: FormBuilder,
    private route: ActivatedRoute,
    private router: Router,
    private dbService: DbService,
    public licenseService: LicenseService
  ) {
    this.topicForm = this.fb.group({
      name: ['', Validators.required],
      items: this.fb.array([], this.minOneItemValidator())
    });
  }

  get items(): FormArray {
    return this.topicForm.get('items') as FormArray;
  }

  ngOnInit() {
    if (!this.licenseService.fullAccess) {
      this.licenseService.requestReopen();
      this.router.navigate(['/topics']);
      return;
    }

    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.isEdit = true;
      this.topicId = +id;
      this.loadTopic(+id);
    } else {
      this.addItem();
    }
  }

async loadTopic(id: number) {
  const topic = await db.topics.get(id);
  if (topic) {
    this.topicForm.patchValue({ name: topic.name });
    const items = await db.items.where('topicId').equals(id).sortBy('order');
    items.forEach((item: Item) => {
    this.items.push(this.createItemFormGroup(item.text, item.image, item.audio));
    });
  }
}

onAudioSelected(blob: Blob | null, index: number) {
  const item = this.items.at(index);
  item.patchValue({ audio: blob });
  if (blob) {
    this.expandedAudioItems.add(item);
  } else {
    this.expandedAudioItems.delete(item);
  }
}

createItemFormGroup(text: string = '', image: Blob | null = null, audio: Blob | null = null): FormGroup {
  return this.fb.group({
    text: [text],
    image: [image],
    audio: [audio]
  }, { validators: (group: AbstractControl) => {
      const g = group as FormGroup;
      return g.get('text')?.value || g.get('image')?.value || g.get('audio')?.value ? null : { atLeastOne: true };
    }
  });
}

  minOneItemValidator(): ValidatorFn {
    return (control: AbstractControl) => {
      const formArray = control as FormArray;
      return formArray.length > 0 ? null : { noItems: true };
    };
  }

  addItem() {
    if (!this.licenseService.fullAccess) {
      this.licenseService.requestReopen();
      return;
    }
    this.items.push(this.createItemFormGroup());
  }

  addItemAt(index: number) {
    if (!this.licenseService.fullAccess) {
      this.licenseService.requestReopen();
      return;
    }
    this.items.insert(index, this.createItemFormGroup());
  }

  removeItem(index: number) {
    if (!this.licenseService.fullAccess) {
      this.licenseService.requestReopen();
      return;
    }
    this.items.removeAt(index);
  }

  drop(event: CdkDragDrop<FormGroup[]>) {
    moveItemInArray(this.items.controls, event.previousIndex, event.currentIndex);
    this.items.updateValueAndValidity();
  }

onImageSelected(blob: Blob | null, index: number) {
  const item = this.items.at(index);
  item.patchValue({ image: blob });
  if (blob) {
    this.expandedImageItems.add(item);
  } else {
    this.expandedImageItems.delete(item);
  }
}

openImagePanel(item: AbstractControl) {
  this.expandedImageItems.add(item);
}

openAudioPanel(item: AbstractControl) {
  this.expandedAudioItems.add(item);
}

isImagePanelOpen(item: AbstractControl): boolean {
  return this.expandedImageItems.has(item) || !!item.get('image')?.value;
}

isAudioPanelOpen(item: AbstractControl): boolean {
  return this.expandedAudioItems.has(item) || !!item.get('audio')?.value;
}

  async onSubmit() {
    if (!this.licenseService.fullAccess) {
      this.licenseService.requestReopen();
      return;
    }

    if (this.topicForm.invalid) return;

    const name = this.topicForm.value.name;
    const items = await Promise.all(this.items.controls.map(c => c.value).map(async (item: any) => ({
      text: item.text,
      image: item.image,
      audio: item.audio   
    })));

    if (this.isEdit && this.topicId) {
      await this.dbService.updateTopic(this.topicId, name);
      await this.dbService.updateItems(this.topicId, items);
      this.router.navigate(['/topics', this.topicId, 'activities']);
    } else {
      const newId = await this.dbService.createTopic(name);
      await this.dbService.addItems(newId, items);
      this.router.navigate(['/topics', newId, 'activities']);
    }
  }

  goBack() {
    this.router.navigate(['/topics']);
  }

}
