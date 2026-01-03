import type Database from 'better-sqlite3';

type ReviewCategory = 'AMEI' | 'JOGAVEL' | 'RUIM';
type ReviewMediaType = 'GAME' | 'MOVIE';

type SeedReview = {
  type: ReviewMediaType;
  title: string;
  stars: number;
  category: ReviewCategory;
  opinion: string;
  romanceClosed?: boolean;
};

const SEED_REVIEWS: SeedReview[] = [
  {
    type: 'MOVIE',
    title: 'Questão de Tempo',
    stars: 5,
    category: 'AMEI',
    opinion: 'Romance leve e emocional, final bem amarrado.',
    romanceClosed: true,
  },
  {
    type: 'MOVIE',
    title: 'Orgulho e Preconceito (2005)',
    stars: 5,
    category: 'AMEI',
    opinion: 'Clássico, química absurda e um final satisfatório.',
    romanceClosed: true,
  },
  {
    type: 'MOVIE',
    title: 'Doentes de Amor',
    stars: 4,
    category: 'JOGAVEL',
    opinion: 'Engraçado e sincero, romance realista e fecha bem.',
    romanceClosed: true,
  },
  {
    type: 'MOVIE',
    title: 'Amor & Outras Drogas',
    stars: 4,
    category: 'JOGAVEL',
    opinion: 'Mais adulto, drama forte, e o romance tem conclusão.',
    romanceClosed: true,
  },
  {
    type: 'MOVIE',
    title: 'Como Eu Era Antes de Você',
    stars: 3,
    category: 'JOGAVEL',
    opinion: 'Dói, mas é bem feito; final é fechado mesmo sendo triste.',
    romanceClosed: true,
  },
  {
    type: 'GAME',
    title: 'Florence',
    stars: 5,
    category: 'AMEI',
    opinion: 'Curto, perfeito e devastador (no bom sentido).',
  },
  {
    type: 'GAME',
    title: "Baldur's Gate 3",
    stars: 5,
    category: 'AMEI',
    opinion: 'Romances marcantes + escolhas com peso. Obra-prima.',
  },
  {
    type: 'GAME',
    title: 'Life is Strange',
    stars: 4,
    category: 'JOGAVEL',
    opinion: 'História intensa, relações fortes e um final bem fechado.',
  },
  {
    type: 'GAME',
    title: 'Stardew Valley',
    stars: 4,
    category: 'JOGAVEL',
    opinion: 'Romance fofo e progressão viciante; ótimo pra relaxar.',
  },
  {
    type: 'GAME',
    title: 'Catherine: Full Body',
    stars: 3,
    category: 'JOGAVEL',
    opinion: 'Estranho e estiloso, mas o romance e escolhas seguram.',
  },
];

function normalizeMediaName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

function normalizeMediaKey(name: string): string {
  if (!name) return '';
  return name
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function getGuildsWithData(db: Database.Database): string[] {
  const rows = db
    .prepare(
      `SELECT guild_id FROM guild_settings
       UNION SELECT guild_id FROM users
       UNION SELECT guild_id FROM profile
       UNION SELECT guild_id FROM roll_history
       UNION SELECT guild_id FROM history_events
       UNION SELECT guild_id FROM question_history
       UNION SELECT guild_id FROM steam_links`,
    )
    .all() as Array<{ guild_id: string }>;
  return rows.map((row) => row.guild_id).filter(Boolean);
}

export function seedDefaultReviewsDb(
  db: Database.Database,
  guildId: string,
  ownerId: string,
): number {
  const existingReviews = db
    .prepare('SELECT COUNT(1) as count FROM reviews WHERE guild_id = ?')
    .get(guildId) as { count?: number } | undefined;
  const existingItems = db
    .prepare('SELECT COUNT(1) as count FROM review_items WHERE guild_id = ?')
    .get(guildId) as { count?: number } | undefined;

  if ((existingReviews?.count ?? 0) > 0 || (existingItems?.count ?? 0) > 0) {
    return 0;
  }

  const insertReview = db.prepare(
    `INSERT OR IGNORE INTO reviews (
        guild_id, user_id, type, item_key, item_name, stars, category, opinion, tags_json,
        favorite, romance_closed, platform, created_at, updated_at, seed
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const insertItem = db.prepare(
    `INSERT OR IGNORE INTO review_items (
        guild_id, type, item_key, name, platforms_json, created_at,
        stars_sum, count, avg_stars, category_counts_json, romance_closed_count, romance_open_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  let seededCount = 0;
  const now = Date.now();

  const tx = db.transaction(() => {
    for (const seed of SEED_REVIEWS) {
      const name = normalizeMediaName(seed.title);
      const itemKey = normalizeMediaKey(name);
      const romanceClosed = seed.type === 'MOVIE' ? (seed.romanceClosed ? 1 : 0) : null;
      const categoryCounts = {
        AMEI: seed.category === 'AMEI' ? 1 : 0,
        JOGAVEL: seed.category === 'JOGAVEL' ? 1 : 0,
        RUIM: seed.category === 'RUIM' ? 1 : 0,
      };
      const stats = {
        starsSum: seed.stars,
        count: 1,
        avgStars: seed.stars,
        categoryCountsJson: JSON.stringify(categoryCounts),
        romanceClosedCount: seed.type === 'MOVIE' && seed.romanceClosed ? 1 : 0,
        romanceOpenCount: 0,
      };

      const reviewInfo = insertReview.run(
        guildId,
        ownerId,
        seed.type,
        itemKey,
        name,
        seed.stars,
        seed.category,
        seed.opinion,
        null,
        0,
        romanceClosed,
        null,
        now,
        now,
        1,
      );

      insertItem.run(
        guildId,
        seed.type,
        itemKey,
        name,
        JSON.stringify([]),
        now,
        stats.starsSum,
        stats.count,
        stats.avgStars,
        stats.categoryCountsJson,
        stats.romanceClosedCount,
        stats.romanceOpenCount,
      );

      if (reviewInfo.changes > 0) {
        seededCount += 1;
      }
    }
  });

  tx();
  return seededCount;
}

export function seedDefaultReviewsForExistingGuilds(
  db: Database.Database,
  ownerId: string,
): Array<{ guildId: string; seededCount: number }> {
  const results: Array<{ guildId: string; seededCount: number }> = [];
  const guilds = getGuildsWithData(db);
  for (const guildId of guilds) {
    const seededCount = seedDefaultReviewsDb(db, guildId, ownerId);
    if (seededCount > 0) {
      results.push({ guildId, seededCount });
    }
  }
  return results;
}
