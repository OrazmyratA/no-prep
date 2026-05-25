// Recovery script: reconstructs language.ts from the compiled JS bundle in the Electron ASAR extract
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BUNDLE = path.join(ROOT, 'release/_asar_extracted/dist/no-prep/browser/chunk-G52DYJH5.js');
const OUT    = path.join(ROOT, 'src/app/core/language.ts');

const content = fs.readFileSync(BUNDLE, 'utf8');

// Extract the translations object by brace-depth tracking
const startMarker = 'translations={gameResults:';
const startIdx = content.indexOf(startMarker);
if (startIdx < 0) throw new Error('Could not find translations object in bundle');

let depth = 0, i = startIdx + 'translations='.length;
while (i < content.length) {
  if (content[i] === '{') depth++;
  else if (content[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  i++;
}
const objStr = content.substring(startIdx + 'translations='.length, i);
const translations = vm.runInNewContext('var t = ' + objStr + '; t', {}, { timeout: 10000 });

console.log(`Extracted ${Object.keys(translations).length} translation keys`);

// Inject new Android-specific keys not present in the original bundle
translations['androidGoogleImagesGuide'] = {
  en: 'On Android, copy the image URL from Google Images, then paste it in the URL field below.',
  tk: 'Android-da Google Suratlardan surat URL-ni gochurin, sonra asagdaky URL meydanyna goyjun.',
  ru: 'Na Android skopiruyte URL izobrazheniya iz Google Kartinki, zatem vstavte ego v pole URL nizhe.',
  cn: 'zai Android shang, cong Google tu pian fu zhi tu pian URL, ran hou zhan tie dao xia mian de URL zi duan zhong.',
  cde: 'Kopiere auf Android die Bild-URL von Google Bilder und fuege sie in das URL-Feld unten ein.',
  es: 'En Android, copia la URL de la imagen de Google Imagenes, luego pegala en el campo URL de abajo.',
  fr: 'Sur Android, copiez l\'URL de l\'image depuis Google Images, puis collez-la dans le champ URL ci-dessous.',
  kr: 'Android eseo Google i mi ji ui i mi ji URL eul bok sa han da eum a rae URL pil de e but yeo neow eu se yo.',
  sa: 'ala Android, insakh rabat al-surah min suwar Google, thumma ilsaqahu fi haql al-rabat adnahu.',
};

translations['androidPasteHint'] = {
  en: 'Tip: On Android, copy an image URL and use the Paste URL button below.',
  tk: 'Maslahat: Android-da surat URL-ni gochurin we asagdaky URL goyjun duwmesini ulanyng.',
  ru: 'Podskazka: Na Android skopiruyte URL izobrazheniya i ispolzuyte knopku Vstavit URL nizhe.',
  cn: 'Ti shi: zai Android shang, fu zhi tu pian URL bing shi yong xia mian de zhan tie URL an niu.',
  cde: 'Tipp: Kopiere auf Android eine Bild-URL und verwende die Schaltflaeche URL einfuegen unten.',
  es: 'Consejo: En Android, copia una URL de imagen y usa el boton Pegar URL a continuacion.',
  fr: 'Astuce: Sur Android, copiez une URL d\'image et utilisez le bouton Coller l\'URL ci-dessous.',
  kr: 'Ti p: Android e seo i mi ji URL eul bok sa ha go a rae ui URL but yeo neow gi but teun eul sa yong ha se yo.',
  sa: 'Nasihah: ala Android, insakh rabat surah wastakhdim zirr ilsaq al-rabat adnah.',
};

translations['androidPasteFallback'] = {
  en: 'Clipboard paste is not supported here. Please use the URL field to import an image.',
  tk: 'Gochurmek gysganch bukjadan goymak bu yerde goldanmayyar. Surat import etmek ucin URL meydanyny ulanyng.',
  ru: 'Vstavka iz bufera obmena zdes ne podderzhivaetsya. Ispolzuyte pole URL dlya importa izobrazheniya.',
  cn: 'ci chu bu zhi chi jian tie ban zhan tie. qing shi yong URL zi duan dao ru tu pian.',
  cde: 'Das Einfuegen aus der Zwischenablage wird hier nicht unterstuetzt. Bitte verwende das URL-Feld, um ein Bild zu importieren.',
  es: 'El pegado del portapapeles no esta admitido aqui. Utiliza el campo URL para importar una imagen.',
  fr: 'Le collage depuis le presse-papiers n\'est pas pris en charge ici. Veuillez utiliser le champ URL pour importer une image.',
  kr: 'yeo gi seo neun keul lib bo deu but yeo neow gi ga ji won doe ji an seub ni da. URL pil deu reul sa yong ha yeo i mi ji reul ga jyeo o se yo.',
  sa: 'lasq al-hafizah ghair madoom huna. yurja istikhdaam haql al-rabat listawrad surah.',
};

console.log(`Total keys after injection: ${Object.keys(translations).length}`);

const LANGS = ['en','tk','ru','cn','cde','es','fr','kr','sa'];

function escapeForSingleQuote(str) {
  // escape backslashes, then single quotes, then newlines/carriage returns
  return str
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r\n/g, '\\n')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

let lines = [];

// File header + class opening
lines.push(`import { Injectable } from '@angular/core';`);
lines.push(`import { BehaviorSubject } from 'rxjs';`);
lines.push(``);
lines.push(`export type SupportedLanguage = 'en' | 'tk' | 'ru' | 'cn' | 'cde' | 'es' | 'fr' | 'kr' | 'sa';`);
lines.push(``);
lines.push(`export interface TranslationDictionary {`);
lines.push(`  [key: string]: {`);
lines.push(`    en: string;`);
lines.push(`    tk: string;`);
lines.push(`    ru: string;`);
lines.push(`    cn: string;`);
lines.push(`    cde: string;`);
lines.push(`    es: string;`);
lines.push(`    fr: string;`);
lines.push(`    kr: string;`);
lines.push(`    sa: string;`);
lines.push(`  };`);
lines.push(`}`);
lines.push(``);
lines.push(`@Injectable({ providedIn: 'root' })`);
lines.push(`export class LanguageService {`);
lines.push(`  private currentLangSubject = new BehaviorSubject<SupportedLanguage>('en');`);
lines.push(`  currentLang$ = this.currentLangSubject.asObservable();`);
lines.push(``);
lines.push(`private translations: TranslationDictionary = {`);

// Emit all translation entries
for (const [key, val] of Object.entries(translations)) {
  lines.push(`'${key}': {`);
  for (const lang of LANGS) {
    const raw = (val[lang] !== undefined ? val[lang] : '');
    lines.push(`  ${lang}: '${escapeForSingleQuote(raw)}',`);
  }
  lines.push(`},`);
  lines.push(``);
}

lines.push(`};`);
lines.push(``);

// Service methods
lines.push(`  get currentLang(): SupportedLanguage {`);
lines.push(`    return this.currentLangSubject.value;`);
lines.push(`  }`);
lines.push(``);
lines.push(`  setLanguage(lang: SupportedLanguage) {`);
lines.push(`    this.currentLangSubject.next(lang);`);
lines.push(`    localStorage.setItem('appLanguage', lang);`);
lines.push(`  }`);
lines.push(``);
lines.push(`  translate(key: string, params?: Record<string, any>): string {`);
lines.push(`    const entry = this.translations[key];`);
lines.push(`    if (!entry) {`);
lines.push(`      console.warn(\`Translation missing for key: \${key}\`);`);
lines.push(`      return key;`);
lines.push(`    }`);
lines.push(`    let text = entry[this.currentLang];`);
lines.push(`    if (!text) {`);
lines.push(`      // Fallback to English if the specific language translation is missing`);
lines.push(`      text = entry.en;`);
lines.push(`    }`);
lines.push(`    if (params) {`);
lines.push(`      Object.entries(params).forEach(([param, value]) => {`);
lines.push(`        text = text.replace(\`{\${param}}\`, value);`);
lines.push(`      });`);
lines.push(`    }`);
lines.push(`    return text;`);
lines.push(`  }`);
lines.push(`}`);

const output = lines.join('\n');
fs.writeFileSync(OUT, output, 'utf8');
console.log(`Wrote ${OUT}`);
console.log(`Lines: ${lines.length}, Chars: ${output.length}`);
