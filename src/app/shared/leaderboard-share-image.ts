import { LeaderboardEntry } from './leaderboard.model';

export interface LeaderboardShareLabels {
  title: string;
  absent: string;
}

const WIDTH = 900;
const SCALE = 2;
const PADDING = 40;
const HEADER_HEIGHT = 150;
const ROW_HEIGHT = 84;
const ROW_GAP = 12;
const DIVIDER_HEIGHT = 44;
const FOOTER_HEIGHT = 56;
const AVATAR = 56;
const FONT = '"Segoe UI", system-ui, -apple-system, Roboto, sans-serif';

// Same dense ranking as the on-screen ranking button: students tied on points share a rank and
// the next distinct score continues right after (1, 1, 2 ...).
function rankPresent(entries: LeaderboardEntry[]): { entry: LeaderboardEntry; rank: number }[] {
  const sorted = [...entries].sort((a, b) => b.points - a.points || a.text.localeCompare(b.text));
  let rank = 0;
  let previous: number | null = null;
  return sorted.map(entry => {
    if (previous === null || entry.points !== previous) {
      rank++;
      previous = entry.points;
    }
    return { entry, rank };
  });
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let trimmed = text;
  while (trimmed.length > 1 && ctx.measureText(trimmed + '…').width > maxWidth) {
    trimmed = trimmed.slice(0, -1);
  }
  return trimmed + '…';
}

async function loadBitmaps(entries: LeaderboardEntry[]): Promise<Map<number, ImageBitmap>> {
  const bitmaps = new Map<number, ImageBitmap>();
  await Promise.all(
    entries.map(async entry => {
      if (!entry.image) return;
      try {
        bitmaps.set(entry.itemId, await createImageBitmap(entry.image));
      } catch {
        // Unreadable image — the initial-letter avatar is drawn instead.
      }
    })
  );
  return bitmaps;
}

function drawAvatar(
  ctx: CanvasRenderingContext2D,
  entry: LeaderboardEntry,
  bitmap: ImageBitmap | undefined,
  x: number,
  y: number
) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x + AVATAR / 2, y + AVATAR / 2, AVATAR / 2, 0, Math.PI * 2);
  ctx.clip();
  if (bitmap) {
    const side = Math.min(bitmap.width, bitmap.height);
    ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, x, y, AVATAR, AVATAR);
  } else {
    const gradient = ctx.createLinearGradient(x, y, x + AVATAR, y + AVATAR);
    gradient.addColorStop(0, '#60a5fa');
    gradient.addColorStop(1, '#a855f7');
    ctx.fillStyle = gradient;
    ctx.fillRect(x, y, AVATAR, AVATAR);
    ctx.fillStyle = '#ffffff';
    ctx.font = `800 26px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText((entry.text.trim()[0] ?? '?').toUpperCase(), x + AVATAR / 2, y + AVATAR / 2 + 1);
  }
  ctx.restore();
}

function drawRow(
  ctx: CanvasRenderingContext2D,
  entry: LeaderboardEntry,
  rank: number | null,
  bitmap: ImageBitmap | undefined,
  y: number,
  labels: LeaderboardShareLabels
) {
  const x = PADDING;
  const w = WIDTH - PADDING * 2;
  const absent = !!entry.absent;

  ctx.save();
  if (absent) ctx.globalAlpha = 0.55;

  ctx.shadowColor = 'rgba(15, 23, 42, 0.1)';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 2;
  ctx.fillStyle = '#ffffff';
  roundRect(ctx, x, y, w, ROW_HEIGHT, 18);
  ctx.fill();
  ctx.shadowColor = 'transparent';

  if (entry.color) {
    ctx.save();
    roundRect(ctx, x, y, w, ROW_HEIGHT, 18);
    ctx.clip();
    ctx.fillStyle = entry.color;
    ctx.fillRect(x, y, 8, ROW_HEIGHT);
    ctx.restore();
  }

  const midY = y + ROW_HEIGHT / 2;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  if (rank != null && rank <= 3) {
    ctx.font = `34px ${FONT}`;
    ctx.fillText(rank === 1 ? '🥇' : rank === 2 ? '🥈' : '🥉', x + 46, midY + 2);
  } else {
    ctx.fillStyle = '#475569';
    ctx.font = `800 26px ${FONT}`;
    ctx.fillText(rank == null ? '–' : String(rank), x + 46, midY + 1);
  }

  drawAvatar(ctx, entry, bitmap, x + 86, y + (ROW_HEIGHT - AVATAR) / 2);

  const textX = x + 86 + AVATAR + 18;
  const rightBlock = 150;
  ctx.textAlign = 'left';
  ctx.fillStyle = '#1f2937';
  ctx.font = `700 28px ${FONT}`;
  ctx.fillText(fitText(ctx, entry.text, x + w - rightBlock - textX), textX, midY + 1);

  ctx.textAlign = 'right';
  if (absent) {
    ctx.fillStyle = '#4b5563';
    ctx.font = `800 20px ${FONT}`;
    ctx.fillText(labels.absent.toUpperCase(), x + w - 26, midY + 1);
  } else {
    ctx.fillStyle = '#f59e0b';
    ctx.font = `800 34px ${FONT}`;
    const pointsText = String(entry.points);
    ctx.fillText(pointsText, x + w - 62, midY + 1);
    ctx.font = `30px ${FONT}`;
    ctx.fillText('⭐', x + w - 22, midY + 1);
  }
  ctx.restore();
}

export async function renderLeaderboardImage(
  entries: LeaderboardEntry[],
  topicName: string,
  labels: LeaderboardShareLabels
): Promise<Blob> {
  const present = rankPresent(entries.filter(e => !e.absent));
  const absentEntries = entries.filter(e => e.absent).sort((a, b) => a.text.localeCompare(b.text));
  const bitmaps = await loadBitmaps(entries);

  const rowsHeight = (count: number) => (count ? count * ROW_HEIGHT + (count - 1) * ROW_GAP : 0);
  const height =
    HEADER_HEIGHT +
    rowsHeight(present.length) +
    (absentEntries.length ? DIVIDER_HEIGHT + rowsHeight(absentEntries.length) : 0) +
    FOOTER_HEIGHT;

  const canvas = document.createElement('canvas');
  canvas.width = WIDTH * SCALE;
  canvas.height = height * SCALE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available.');
  ctx.scale(SCALE, SCALE);

  const background = ctx.createLinearGradient(0, 0, WIDTH, height);
  background.addColorStop(0, '#ffffff');
  background.addColorStop(1, '#e0e7ff');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, WIDTH, height);

  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#4338ca';
  ctx.font = `800 40px ${FONT}`;
  ctx.fillText(fitText(ctx, topicName || labels.title, WIDTH - PADDING * 2), PADDING, 72);
  ctx.fillStyle = '#64748b';
  ctx.font = `600 22px ${FONT}`;
  const date = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  ctx.fillText(`${labels.title}  ·  ${date}`, PADDING, 108);

  let y = HEADER_HEIGHT;
  present.forEach(({ entry, rank }) => {
    drawRow(ctx, entry, rank, bitmaps.get(entry.itemId), y, labels);
    y += ROW_HEIGHT + ROW_GAP;
  });

  if (absentEntries.length) {
    if (present.length) y -= ROW_GAP;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#94a3b8';
    ctx.font = `800 18px ${FONT}`;
    ctx.fillText(labels.absent.toUpperCase(), PADDING, y + DIVIDER_HEIGHT / 2 + 4);
    y += DIVIDER_HEIGHT;
    absentEntries.forEach(entry => {
      drawRow(ctx, entry, null, bitmaps.get(entry.itemId), y, labels);
      y += ROW_HEIGHT + ROW_GAP;
    });
  }

  bitmaps.forEach(bitmap => bitmap.close());

  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('Could not create image.'))), 'image/png');
  });
}
