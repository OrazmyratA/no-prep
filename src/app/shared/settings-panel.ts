import { Component, Input, Output, EventEmitter, OnInit, OnChanges, OnDestroy, SimpleChanges } from '@angular/core';
import { FormArray, FormBuilder, FormGroup } from '@angular/forms';
import { Subscription } from 'rxjs';
import { LanguageService, SupportedLanguage } from '../core/language';

interface SpellingRuleCategory {
  id: string;
  labelKey: string;
  options: string[];
}

@Component({
  selector: 'app-settings-panel',
  standalone: false,
  templateUrl: `./settings-panel.html`
})
export class SettingsPanelComponent implements OnInit, OnChanges, OnDestroy {
  @Input() gameId!: string;
  @Output() settingsChange = new EventEmitter<any>();
  settingsForm!: FormGroup;
  expandedSpellingCategories: Record<string, boolean> = {};
  private currentLang: SupportedLanguage = 'en';
  private langSubscription?: Subscription;

  private readonly spellingCategoriesMap: Record<string, SpellingRuleCategory[]> = {
    en: [
      {
        id: 'suffix',
        labelKey: 'settingsSpellingCheckSuffixes',
        options: ['-ing', '-ed', '-s', '-es', '-ly', '-er', '-est', '-ful', '-less', '-ness', '-ment', '-able']
      },
      {
        id: 'prefix',
        labelKey: 'settingsSpellingCheckPrefixes',
        options: ['un-', 're-', 'pre-', 'mis-', 'dis-', 'non-', 'anti-', 'over-', 'under-', 'in-', 'im-', 'ir-', 'il-']
      },
      {
        id: 'preposition',
        labelKey: 'settingsSpellingCheckPrepositions',
        options: ['in', 'on', 'at', 'to', 'from', 'for', 'of', 'with', 'by', 'about', 'into', 'through', 'before', 'after', 'between', 'under', 'over']
      },
      {
        id: 'article',
        labelKey: 'settingsSpellingCheckArticles',
        options: ['a', 'an', 'the']
      },
      {
        id: 'conjunction',
        labelKey: 'settingsSpellingCheckConjunctions',
        options: ['and', 'or', 'but', 'so', 'because', 'although', 'if', 'when', 'while', 'before', 'after']
      },
      {
        id: 'adverb',
        labelKey: 'settingsSpellingCheckAdverbs',
        options: ['-ly', 'very', 'too', 'always', 'often', 'never', 'sometimes', 'usually', 'quickly', 'slowly']
      },
      {
        id: 'verb',
        labelKey: 'settingsSpellingCheckVerbs',
        options: ['am', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'can', 'could', 'will', 'would', 'should', 'must']
      }
    ],
    ru: [
      {
        id: 'ru_verb',
        labelKey: 'settingsSpellingCheckRuVerbEndings',
        options: ['-ть', '-ти', '-чь', '-ет', '-ит', '-ат', '-ят', '-ут', '-ют', '-ешь', '-ишь', '-ем', '-им', '-ал', '-ала', '-или']
      },
      {
        id: 'ru_adj',
        labelKey: 'settingsSpellingCheckRuAdjEndings',
        options: ['-ый', '-ий', '-ой', '-ая', '-яя', '-ое', '-ее', '-ых', '-их', '-ым', '-им', '-ую', '-юю']
      },
      {
        id: 'ru_case',
        labelKey: 'settingsSpellingCheckRuCaseEndings',
        options: ['-ого', '-его', '-ому', '-ему', '-ом', '-ем', '-ой', '-ей', '-ов', '-ев', '-ам', '-ям', '-ах', '-ях', '-ами', '-ями']
      },
      {
        id: 'ru_prefix',
        labelKey: 'settingsSpellingCheckRuPrefixes',
        options: ['не-', 'пере-', 'за-', 'по-', 'при-', 'от-', 'вы-', 'на-', 'со-', 'под-', 'над-', 'раз-', 'без-', 'про-', 'пре-', 'пред-']
      },
      {
        id: 'ru_prep',
        labelKey: 'settingsSpellingCheckRuPrepositions',
        options: ['в', 'на', 'за', 'под', 'над', 'при', 'от', 'до', 'из', 'без', 'для', 'по', 'с', 'к', 'о', 'об', 'между', 'через', 'перед', 'после']
      },
      {
        id: 'ru_conj',
        labelKey: 'settingsSpellingCheckRuConjunctions',
        options: ['и', 'а', 'но', 'или', 'если', 'когда', 'что', 'как', 'чтобы', 'хотя', 'пока', 'тоже', 'также', 'ни', 'то']
      }
    ],
    tk: [
      {
        id: 'tk_verb',
        labelKey: 'settingsSpellingCheckTkVerbEndings',
        options: ['-ýar', '-ýär', '-ar', '-er', '-dy', '-di', '-du', '-dü', '-jak', '-jek', '-mek', '-mak', '-dym', '-dim', '-dyň', '-diň']
      },
      {
        id: 'tk_case',
        labelKey: 'settingsSpellingCheckTkCaseEndings',
        options: ['-yň', '-iň', '-nyň', '-niň', '-a', '-e', '-ga', '-ge', '-y', '-i', '-ny', '-ni', '-da', '-de', '-nda', '-nde', '-dan', '-den', '-ndan', '-nden']
      },
      {
        id: 'tk_suffix',
        labelKey: 'settingsSpellingCheckTkSuffixes',
        options: ['-ly', '-li', '-lu', '-lü', '-syz', '-siz', '-suz', '-süz', '-çy', '-çi', '-lyk', '-lik', '-luk', '-lük', '-lar', '-ler']
      },
      {
        id: 'tk_postpos',
        labelKey: 'settingsSpellingCheckTkPostpositions',
        options: ['üçin', 'bilen', 'hakda', 'barada', 'garşy', 'görä', 'çenli', 'soňra', 'öňünde', 'içinde', 'daşynda', 'degişli']
      },
      {
        id: 'tk_conj',
        labelKey: 'settingsSpellingCheckTkConjunctions',
        options: ['we', 'ýa-da', 'ýöne', 'emma', 'sebäbi', 'eger', 'haçan', 'hem', 'ýa', 'şonuň üçin']
      }
    ],
    cde: [
      {
        id: 'de_verb',
        labelKey: 'settingsSpellingCheckDeVerbEndings',
        options: ['-e', '-st', '-t', '-en', '-et', '-est', '-te', '-test', '-ten', '-tet', '-ern', '-eln']
      },
      {
        id: 'de_adj',
        labelKey: 'settingsSpellingCheckDeAdjEndings',
        options: ['-e', '-er', '-es', '-em', '-en', '-ere', '-erer', '-eres', '-erem', '-eren']
      },
      {
        id: 'de_prefix',
        labelKey: 'settingsSpellingCheckDePrefixes',
        options: ['be-', 'ge-', 'er-', 'ver-', 'zer-', 'ent-', 'ab-', 'an-', 'auf-', 'aus-', 'ein-', 'mit-', 'nach-', 'vor-', 'zu-', 'miss-']
      },
      {
        id: 'de_prep',
        labelKey: 'settingsSpellingCheckDePrepositions',
        options: ['an', 'auf', 'aus', 'bei', 'bis', 'durch', 'für', 'gegen', 'hinter', 'in', 'mit', 'nach', 'neben', 'ohne', 'über', 'um', 'unter', 'von', 'vor', 'während', 'wegen', 'zu', 'zwischen']
      },
      {
        id: 'de_article',
        labelKey: 'settingsSpellingCheckDeArticles',
        options: ['der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einen', 'einem', 'einer', 'eines']
      },
      {
        id: 'de_conj',
        labelKey: 'settingsSpellingCheckDeConjunctions',
        options: ['und', 'oder', 'aber', 'denn', 'sondern', 'weil', 'dass', 'wenn', 'als', 'ob', 'obwohl', 'damit', 'bevor', 'nachdem', 'während', 'falls']
      }
    ],
    fr: [
      {
        id: 'fr_verb',
        labelKey: 'settingsSpellingCheckFrVerbEndings',
        options: ['-er', '-ir', '-re', '-e', '-es', '-ons', '-ez', '-ent', '-ais', '-ait', '-ions', '-iez', '-aient', '-é', '-i', '-u', '-ant']
      },
      {
        id: 'fr_adj',
        labelKey: 'settingsSpellingCheckFrAdjEndings',
        options: ['-e', '-s', '-es', '-eux', '-euse', '-euses', '-if', '-ive', '-al', '-ale', '-el', '-elle', '-ien', '-ienne']
      },
      {
        id: 'fr_prefix',
        labelKey: 'settingsSpellingCheckFrPrefixes',
        options: ['dé-', 'dés-', 're-', 'ré-', 'in-', 'im-', 'il-', 'ir-', 'pré-', 'sous-', 'sur-', 'anti-', 'contre-', 'inter-', 'trans-', 'super-']
      },
      {
        id: 'fr_prep',
        labelKey: 'settingsSpellingCheckFrPrepositions',
        options: ['à', 'de', 'en', 'dans', 'sur', 'sous', 'avec', 'pour', 'par', 'sans', 'entre', 'vers', 'depuis', 'avant', 'après', 'devant', 'derrière', 'chez', 'selon', 'pendant']
      },
      {
        id: 'fr_article',
        labelKey: 'settingsSpellingCheckFrArticles',
        options: ['le', 'la', 'les', 'un', 'une', 'des', 'du', 'au', 'aux', "l'"]
      },
      {
        id: 'fr_conj',
        labelKey: 'settingsSpellingCheckFrConjunctions',
        options: ['et', 'ou', 'mais', 'donc', 'car', 'ni', 'or', 'que', 'qui', 'quand', 'comme', 'si', 'lorsque', 'puisque', 'bien que', 'afin que']
      }
    ],
    es: [
      {
        id: 'es_verb',
        labelKey: 'settingsSpellingCheckEsVerbEndings',
        options: ['-ar', '-er', '-ir', '-o', '-as', '-a', '-amos', '-an', '-es', '-aba', '-ía', '-ado', '-ido', '-ando', '-iendo', '-aron', '-ieron']
      },
      {
        id: 'es_adj',
        labelKey: 'settingsSpellingCheckEsAdjEndings',
        options: ['-o', '-a', '-os', '-as', '-oso', '-osa', '-ivo', '-iva', '-able', '-ible', '-al', '-nte', '-ísimo', '-ísima']
      },
      {
        id: 'es_prefix',
        labelKey: 'settingsSpellingCheckEsPrefixes',
        options: ['des-', 'in-', 'im-', 're-', 'pre-', 'sub-', 'sobre-', 'super-', 'anti-', 'inter-', 'trans-', 'con-', 'contra-', 'extra-', 'semi-', 'pro-']
      },
      {
        id: 'es_prep',
        labelKey: 'settingsSpellingCheckEsPrepositions',
        options: ['a', 'de', 'en', 'con', 'sin', 'para', 'por', 'sobre', 'bajo', 'ante', 'tras', 'hacia', 'desde', 'hasta', 'entre', 'según', 'durante']
      },
      {
        id: 'es_article',
        labelKey: 'settingsSpellingCheckEsArticles',
        options: ['el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'al', 'del']
      },
      {
        id: 'es_conj',
        labelKey: 'settingsSpellingCheckEsConjunctions',
        options: ['y', 'o', 'pero', 'sino', 'ni', 'que', 'porque', 'cuando', 'como', 'si', 'aunque', 'mientras', 'pues', 'ya que', 'sin embargo']
      }
    ],
    kr: [
      {
        id: 'kr_particle',
        labelKey: 'settingsSpellingCheckKrParticles',
        options: ['-이', '-가', '-을', '-를', '-은', '-는', '-에', '-에서', '-으로', '-로', '-와', '-과', '-의', '-도', '-만', '-한테', '-에게', '-이랑', '-랑']
      },
      {
        id: 'kr_verb',
        labelKey: 'settingsSpellingCheckKrVerbEndings',
        options: ['-아요', '-어요', '-습니다', '-ㅂ니다', '-았어요', '-었어요', '-고', '-아서', '-어서', '-지만', '-으면', '-면', '-는데', '-니까', '-기', '-다']
      },
      {
        id: 'kr_suffix',
        labelKey: 'settingsSpellingCheckKrSuffixes',
        options: ['-하다', '-되다', '-스럽다', '-롭다', '-답다', '-적', '-화', '-이다', '-없다', '-있다']
      },
      {
        id: 'kr_conj',
        labelKey: 'settingsSpellingCheckKrConjunctions',
        options: ['그리고', '하지만', '그래서', '그런데', '왜냐하면', '만약', '그러나', '따라서', '또한', '게다가', '비록', '그러므로', '즉', '결국']
      },
      {
        id: 'kr_adverb',
        labelKey: 'settingsSpellingCheckKrAdverbs',
        options: ['매우', '아주', '정말', '너무', '잘', '못', '다시', '항상', '절대', '자주', '가끔', '빨리', '천천히', '함께', '따로']
      }
    ],
    sa: [
      {
        id: 'sa_prep',
        labelKey: 'settingsSpellingCheckSaPrepositions',
        options: ['في', 'على', 'من', 'إلى', 'عن', 'مع', 'بين', 'حول', 'أمام', 'خلف', 'فوق', 'تحت', 'خلال', 'منذ', 'حتى', 'قبل', 'بعد', 'عند']
      },
      {
        id: 'sa_conj',
        labelKey: 'settingsSpellingCheckSaConjunctions',
        options: ['و', 'أو', 'لكن', 'بل', 'أما', 'ثم', 'لأن', 'إذا', 'عندما', 'حيث', 'كي', 'بينما', 'حتى', 'لذلك', 'رغم', 'على الرغم']
      },
      {
        id: 'sa_pronoun',
        labelKey: 'settingsSpellingCheckSaPronouns',
        options: ['هو', 'هي', 'هم', 'هن', 'أنا', 'نحن', 'أنت', 'أنتم', 'هذا', 'هذه', 'ذلك', 'تلك', 'الذي', 'التي', 'الذين']
      },
      {
        id: 'sa_question',
        labelKey: 'settingsSpellingCheckSaQuestionWords',
        options: ['من', 'ما', 'ماذا', 'أين', 'كيف', 'متى', 'لماذا', 'هل', 'أي', 'كم']
      },
      {
        id: 'sa_adverb',
        labelKey: 'settingsSpellingCheckSaAdverbs',
        options: ['هنا', 'هناك', 'الآن', 'دائماً', 'أحياناً', 'أبداً', 'قريباً', 'بعيداً', 'اليوم', 'غداً', 'أمس', 'فجأة', 'أخيراً', 'كثيراً', 'قليلاً']
      }
    ],
    cn: [
      {
        id: 'cn_particle',
        labelKey: 'settingsSpellingCheckCnParticles',
        options: ['的', '地', '得', '了', '过', '着', '吗', '呢', '吧', '啊', '嘛', '嗯']
      },
      {
        id: 'cn_prep',
        labelKey: 'settingsSpellingCheckCnPrepositions',
        options: ['在', '从', '到', '向', '对', '为', '被', '把', '跟', '给', '关于', '按照', '由于', '为了']
      },
      {
        id: 'cn_conj',
        labelKey: 'settingsSpellingCheckCnConjunctions',
        options: ['和', '与', '或', '但是', '因为', '所以', '如果', '虽然', '而且', '不但', '即使', '除非', '然而', '否则']
      },
      {
        id: 'cn_measure',
        labelKey: 'settingsSpellingCheckCnMeasureWords',
        options: ['个', '本', '张', '条', '只', '件', '块', '双', '对', '套', '次', '种', '位', '匹', '头']
      },
      {
        id: 'cn_adverb',
        labelKey: 'settingsSpellingCheckCnAdverbs',
        options: ['现在', '今天', '明天', '昨天', '以前', '以后', '经常', '已经', '正在', '马上', '刚才', '将来', '从来', '偶尔']
      }
    ]
  };

  get spellingRuleCategories(): SpellingRuleCategory[] {
    return this.spellingCategoriesMap[this.currentLang] ?? this.spellingCategoriesMap['en'];
  }

  private formSubscription?: Subscription;

  constructor(private fb: FormBuilder, private langService: LanguageService) {}

  ngOnInit() {
    // BehaviorSubject fires synchronously — sets currentLang before createForm() runs
    this.langSubscription = this.langService.currentLang$.subscribe(lang => {
      const changed = lang !== this.currentLang;
      this.currentLang = lang;
      if (!this.settingsForm) {
        this.createForm();
      } else if (changed && this.gameId === 'spelling-check') {
        // Rebuild rule categories when teacher switches language
        this.createForm();
      }
    });
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['gameId'] && !changes['gameId'].isFirstChange()) {
      this.createForm();
    }
  }

  ngOnDestroy() {
    this.formSubscription?.unsubscribe();
    this.langSubscription?.unsubscribe();
  }

  private createForm() {
    this.formSubscription?.unsubscribe();
    switch (this.gameId) {
      case 'reveal-game':
        this.settingsForm = this.fb.group({ timer: [25], gridSize: [14], teamCount: [1], simpleMode: [true] });
        break;
      case 'watch-memorize':
        this.settingsForm = this.fb.group({ count: [3], speed: [5] });
        break;
      case 'spotlight':
        this.settingsForm = this.fb.group({ spotlightSize: [50] });
        break;
      case 'team-tug':
        this.settingsForm = this.fb.group({
          movementSpeed: [5],
          winByClickCount: [false],
          clickTarget: [13],
          enableTimer: [false],
          timerMinutes: [3]
        });
        break;
      case 'cup-clash':
        this.settingsForm = this.fb.group({ cupsPerTeam: [5] });
        break;
      case 'odd-one-out':
        this.settingsForm = this.fb.group({
          itemAmount: [2],
          timerSeconds: [25],
          showItemNames: [true]
        });
        break;
      case 'test-abc':
        this.settingsForm = this.fb.group({ reverseMode: [false] });
        break;
      case 'team-sentence':
        this.settingsForm = this.fb.group({
          speed: [1],
          reverseMode: [false]
        });
        break;
      case 'spin-wheel':
        this.settingsForm = this.fb.group({ textOnWheel: [false], simpleMode: [true] });
        break;
      case 'pop-balloon':
        this.settingsForm = this.fb.group({ teamCount: [1], reverseMode: [false], simpleMode: [true] });
        break;
      case 'squid-game':
        this.settingsForm = this.fb.group({
          teamCount: [2],
          distance: [20],
          enableTimer: [false],
          timerMinutes: [3],
          dollMinTime: [4],
          dollMaxTime: [7],
          reverseMode: [false],
          simpleMode: [true]
        });
        break;
      case 'rock-paper-scissors':
        this.settingsForm = this.fb.group({
          stepsToWin: [10],
          reverseMode: [false],
          simpleMode: [true]
        });
        break;
      case 'spelling-check':
        this.createSpellingCheckForm();
        break;
      default:
        this.settingsForm = this.fb.group({});
    }
    this.emitCurrentSettings();
    this.formSubscription = this.settingsForm.valueChanges.subscribe(() => this.emitCurrentSettings());
  }

  get customRules(): FormArray {
    return this.settingsForm.get('customRules') as FormArray;
  }

  ruleControlName(categoryId: string, index: number): string {
    return `rule_${categoryId}_${index}`;
  }

  toggleSpellingCategory(categoryId: string) {
    this.expandedSpellingCategories[categoryId] = !this.expandedSpellingCategories[categoryId];
  }

  addCustomRule() {
    this.customRules.push(this.fb.control(''));
    this.emitCurrentSettings();
  }

  removeCustomRule(index: number) {
    this.customRules.removeAt(index);
    this.emitCurrentSettings();
  }

  private createSpellingCheckForm() {
    const controls: Record<string, any> = {};
    this.expandedSpellingCategories = {};

    for (const category of this.spellingRuleCategories) {
      this.expandedSpellingCategories[category.id] = false;
      category.options.forEach((_, index) => {
        controls[this.ruleControlName(category.id, index)] = [this.isDefaultSpellingRule(category.id, index)];
      });
    }

    this.settingsForm = this.fb.group({
      ...controls,
      customRules: this.fb.array([])
    });
  }

  private isDefaultSpellingRule(categoryId: string, index: number): boolean {
    return false;
  }

  private emitCurrentSettings() {
    if (this.gameId !== 'spelling-check') {
      this.settingsChange.emit(this.settingsForm.value);
      return;
    }

    const selectedRules: string[] = [];
    for (const category of this.spellingRuleCategories) {
      category.options.forEach((option, index) => {
        if (this.settingsForm.get(this.ruleControlName(category.id, index))?.value) {
          selectedRules.push(option);
        }
      });
    }

    const customRules = this.customRules.controls
      .map(control => String(control.value ?? '').trim())
      .filter(Boolean);

    this.settingsChange.emit({
      omissionRules: JSON.stringify(selectedRules),
      customOmissions: JSON.stringify(customRules)
    });
  }

  private dollDragging: 'min' | 'max' | null = null;

  onDollPointerDown(event: MouseEvent | TouchEvent) {
    event.preventDefault();
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const clientX = 'touches' in event ? (event as TouchEvent).touches[0].clientX : (event as MouseEvent).clientX;
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const val = Math.round(pct * 19) + 1;
    const min = Number(this.settingsForm.get('dollMinTime')?.value);
    const max = Number(this.settingsForm.get('dollMaxTime')?.value);
    this.dollDragging = Math.abs(val - min) <= Math.abs(val - max) ? 'min' : 'max';
    this.applyDollPct(pct);
  }

  onDollPointerMove(event: MouseEvent | TouchEvent) {
    if (!this.dollDragging) return;
    event.preventDefault();
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const clientX = 'touches' in event ? (event as TouchEvent).touches[0].clientX : (event as MouseEvent).clientX;
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    this.applyDollPct(pct);
  }

  onDollPointerUp() { this.dollDragging = null; }

  private applyDollPct(pct: number) {
    const val = Math.round(pct * 19) + 1;
    const min = Number(this.settingsForm.get('dollMinTime')?.value);
    const max = Number(this.settingsForm.get('dollMaxTime')?.value);
    if (this.dollDragging === 'min') {
      this.settingsForm.patchValue({ dollMinTime: Math.max(1, Math.min(val, max - 1)) });
    } else {
      this.settingsForm.patchValue({ dollMaxTime: Math.min(20, Math.max(val, min + 1)) });
    }
  }
}
