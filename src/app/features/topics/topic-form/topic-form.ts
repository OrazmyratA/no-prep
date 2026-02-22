import { Component, OnInit } from '@angular/core';
import { FormArray, FormBuilder, FormGroup, Validators, ValidatorFn, AbstractControl } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { DbService } from '../../../core/db';
import { db, Item } from '../../../core/db.model'; // import db and Item

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

  constructor(
    private fb: FormBuilder,
    private route: ActivatedRoute,
    private router: Router,
    private dbService: DbService
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
    // Use db directly to fetch topic and items
    const topic = await db.topics.get(id);
    if (topic) {
      this.topicForm.patchValue({ name: topic.name });
      const items = await db.items.where('topicId').equals(id).sortBy('order');
      items.forEach((item: Item) => {
        this.items.push(this.createItemFormGroup(item.text, item.image));
      });
    }
  }

createItemFormGroup(text: string = '', image: Blob | null = null): FormGroup {
  return this.fb.group({
    text: [text],
    image: [image]  // store the Blob
  }, { validators: (group: AbstractControl) => {
      const g = group as FormGroup;
      return g.get('text')?.value || g.get('image')?.value ? null : { atLeastOne: true };
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
    this.items.push(this.createItemFormGroup());
  }

  removeItem(index: number) {
    this.items.removeAt(index);
  }

onImageSelected(blob: Blob | null, index: number) {
  this.items.at(index).patchValue({ image: blob });
}

  async onSubmit() {
    if (this.topicForm.invalid) return;

    const name = this.topicForm.value.name;
    const items = this.topicForm.value.items.map((item: any, index: number) => ({
      text: item.text,
      image: item.image
    }));

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