import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { Observable } from 'rxjs';
import { DbService } from '../../../core/db';
import { Topic } from '../../../core/db.model';

@Component({
  selector: 'app-topics-list',
  standalone: false,
  templateUrl: './topics-list.html',
  styleUrls: ['./topics-list.css']
})
export class TopicsListComponent implements OnInit {
  topics$!: Observable<Topic[]>;

  constructor(private db: DbService, private router: Router) {}

  ngOnInit() {
    this.topics$ = this.db.topics$ as unknown as Observable<Topic[]>;
  }

  editTopic(id: number) {
    this.router.navigate(['/topics', id, 'edit']);
  }

  async deleteTopic(id: number) {
    if (confirm('Are you sure you want to delete this topic?')) {
      await this.db.deleteTopic(id);
    }
  }
}