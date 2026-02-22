import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { GAMES, GameConfig } from '../games.config';
import { db } from '../../../core/db.model'; // Direct Dexie import

@Component({
  selector: 'app-activity-select',
  standalone: false,
  templateUrl: './activity-select.html',
  styleUrls: ['./activity-select.css']
})
export class ActivitySelectComponent implements OnInit {
  games = GAMES;
  topicId!: number;
  topicName: string = '';
  selectedGame: GameConfig | null = null;
  showSettings = false;
  settings: any = {};

  constructor(
    private route: ActivatedRoute,
    private router: Router
  ) {}

  async ngOnInit() {
    this.topicId = Number(this.route.snapshot.paramMap.get('id'));
    const topic = await db.topics.get(this.topicId);
    this.topicName = topic?.name || 'Topic';
  }

  onGameClick(game: GameConfig) {
    if (this.selectedGame === game) {
      this.startGame();
    } else {
      this.selectedGame = game;
      if (game.requiresSettings) {
        this.showSettings = true;
      } else {
        this.showSettings = false;
      }
    }
  }

  onSettingsChange(settings: any) {
    this.settings = settings;
  }

  startGame() {
    if (!this.selectedGame) return;
    this.router.navigate(['/topics', this.topicId, 'play', this.selectedGame.id], {
      queryParams: this.settings
    });
  }

  cancelSelection() {
    this.selectedGame = null;
    this.showSettings = false;
    this.settings = {};
  }

  goBack() {
    this.router.navigate(['/topics']);
  }
}