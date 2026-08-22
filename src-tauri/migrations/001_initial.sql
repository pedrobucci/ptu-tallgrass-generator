PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS terrains (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL COLLATE NOCASE UNIQUE,
    min_lvl INTEGER NULL CHECK (min_lvl IS NULL OR min_lvl BETWEEN 0 AND 100),
    max_lvl INTEGER NULL CHECK (max_lvl IS NULL OR max_lvl BETWEEN 0 AND 100),
    encounter_frequency TEXT NOT NULL CHECK (encounter_frequency IN ('uneventful', 'rare', 'normal', 'frequent', 'eventful')),
    shiny_rate REAL NULL CHECK (shiny_rate IS NULL OR shiny_rate BETWEEN 0 AND 1),
    background_source TEXT NULL,
    background_cached_path TEXT NULL,
    schema_version TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK (min_lvl IS NULL OR max_lvl IS NULL OR min_lvl <= max_lvl)
);

CREATE TABLE IF NOT EXISTS terrain_pokemon (
    id TEXT PRIMARY KEY,
    terrain_id TEXT NOT NULL,
    national_dex INTEGER NOT NULL CHECK (national_dex > 0),
    rarity TEXT NOT NULL CHECK (rarity IN ('common', 'unusual', 'rare', 'super_rare', 'legendary')),
    gender_enabled INTEGER NOT NULL CHECK (gender_enabled IN (0, 1)),
    male_percent REAL NULL CHECK (male_percent IS NULL OR male_percent BETWEEN 0 AND 100),
    min_lvl INTEGER NULL CHECK (min_lvl IS NULL OR min_lvl BETWEEN 0 AND 100),
    max_lvl INTEGER NULL CHECK (max_lvl IS NULL OR max_lvl BETWEEN 0 AND 100),
    encounter_weight REAL NULL,
    FOREIGN KEY (terrain_id) REFERENCES terrains(id) ON DELETE CASCADE,
    UNIQUE (terrain_id, national_dex),
    CHECK (min_lvl IS NULL OR max_lvl IS NULL OR min_lvl <= max_lvl)
);

CREATE INDEX IF NOT EXISTS idx_terrain_pokemon_terrain ON terrain_pokemon(terrain_id);

CREATE TABLE IF NOT EXISTS app_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    schema_version TEXT NOT NULL,
    value_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS encounter_history (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    terrain_id TEXT NOT NULL,
    terrain_name TEXT NOT NULL,
    travelled_distance_m REAL NOT NULL CHECK (travelled_distance_m >= 0),
    encounter_probability REAL NOT NULL CHECK (encounter_probability BETWEEN 0 AND 1),
    national_dex INTEGER NOT NULL,
    pokemon_name TEXT NOT NULL,
    display_name TEXT NOT NULL,
    rarity TEXT NOT NULL,
    level INTEGER NOT NULL CHECK (level BETWEEN 0 AND 100),
    gender TEXT NOT NULL CHECK (gender IN ('male', 'female', 'genderless', 'unknown')),
    nature_id INTEGER NOT NULL CHECK (nature_id BETWEEN 1 AND 36),
    nature_name TEXT NOT NULL,
    shiny INTEGER NOT NULL CHECK (shiny IN (0, 1))
);

CREATE INDEX IF NOT EXISTS idx_encounter_history_created ON encounter_history(created_at DESC);

