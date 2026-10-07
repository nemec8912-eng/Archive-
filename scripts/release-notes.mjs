// Описание загрузки в Releases: версия, вид сборки и список изменений этой версии из CHANGELOG.md.
import fs from 'fs';

const { version } = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const log = fs.readFileSync('CHANGELOG.md', 'utf8');
const m = log.match(new RegExp(`## ${version.replace(/\./g, '\\.')}\\n([\\s\\S]*?)(?=\\n## |$)`));
const kind = fs.existsSync('archive-android.kind') ? fs.readFileSync('archive-android.kind', 'utf8').trim() : 'debug';
const build = process.env.GITHUB_RUN_NUMBER || 'локальная';
const out = [
  `Версия ${version} (сборка ${build}).`,
  '',
  kind === 'release'
    ? 'Подписана постоянным ключом: ставится поверх предыдущей версии, данные сохраняются.'
    : 'Тестовая сборка с ключом отладки: перед установкой может понадобиться удалить прежнюю версию (сначала сделайте резервную копию в Настройках).',
  '',
  'Установка: скачать archive-android.apk на телефон и открыть.',
  '',
  '### Что нового',
  (m ? m[1].trim() : '—'),
].join('\n');
fs.writeFileSync('release-notes.md', out + '\n');
console.log(out);
