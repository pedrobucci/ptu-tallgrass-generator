use rusqlite::{params, Connection, OptionalExtension};
use serde::Deserialize;
use std::{fs, time::Duration};
use tauri::{AppHandle, Manager};
use tauri_plugin_log::{Target, TargetKind};
use tauri_plugin_sql::{Migration, MigrationKind};

#[derive(Deserialize)]
struct TerrainPokemonPayload {
    id: String,
    national_dex: i64,
    rarity: String,
    gender_enabled: bool,
    male_percent: Option<f64>,
    min_lvl: Option<i64>,
    max_lvl: Option<i64>,
}

#[derive(Deserialize)]
struct TerrainPayload {
    id: String,
    name: String,
    min_lvl: Option<i64>,
    max_lvl: Option<i64>,
    encounter_frequency: String,
    shiny_rate: Option<f64>,
    background_source: Option<String>,
    background_cached_path: Option<String>,
    schema_version: String,
    created_at: String,
    updated_at: String,
    pokemon_table: Vec<TerrainPokemonPayload>,
}

#[tauri::command]
fn import_terrain_atomic(
    app: AppHandle,
    payload: TerrainPayload,
    replace_terrain_id: Option<String>,
) -> Result<String, String> {
    let config_dir = app.path().app_config_dir().map_err(|error| error.to_string())?;
    fs::create_dir_all(&config_dir).map_err(|error| error.to_string())?;
    let mut connection = Connection::open(config_dir.join("ptu-encounter-generator.db"))
        .map_err(|error| error.to_string())?;
    connection
        .busy_timeout(Duration::from_secs(5))
        .map_err(|error| error.to_string())?;
    connection
        .execute_batch("PRAGMA foreign_keys = ON;")
        .map_err(|error| error.to_string())?;

    import_terrain(&mut connection, payload, replace_terrain_id)
}

fn import_terrain(
    connection: &mut Connection,
    payload: TerrainPayload,
    replace_terrain_id: Option<String>,
) -> Result<String, String> {
    if payload.schema_version != "1.0" {
        return Err("Versão de terreno não suportada.".into());
    }

    let transaction = connection.transaction().map_err(|error| error.to_string())?;
    let terrain_id = if let Some(existing_id) = replace_terrain_id {
        let created_at: Option<String> = transaction
            .query_row(
                "SELECT created_at FROM terrains WHERE id = ?1",
                [&existing_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| error.to_string())?;
        let created_at = created_at.ok_or_else(|| "O terreno a substituir não existe mais.".to_string())?;
        transaction
            .execute(
                "UPDATE terrains SET name=?1,min_lvl=?2,max_lvl=?3,encounter_frequency=?4,shiny_rate=?5,background_source=?6,background_cached_path=?7,schema_version=?8,created_at=?9,updated_at=?10 WHERE id=?11",
                params![payload.name, payload.min_lvl, payload.max_lvl, payload.encounter_frequency, payload.shiny_rate, payload.background_source, payload.background_cached_path, payload.schema_version, created_at, payload.updated_at, existing_id],
            )
            .map_err(|error| error.to_string())?;
        transaction
            .execute("DELETE FROM terrain_pokemon WHERE terrain_id = ?1", [&existing_id])
            .map_err(|error| error.to_string())?;
        existing_id
    } else {
        transaction
            .execute(
                "INSERT INTO terrains(id,name,min_lvl,max_lvl,encounter_frequency,shiny_rate,background_source,background_cached_path,schema_version,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
                params![payload.id, payload.name, payload.min_lvl, payload.max_lvl, payload.encounter_frequency, payload.shiny_rate, payload.background_source, payload.background_cached_path, payload.schema_version, payload.created_at, payload.updated_at],
            )
            .map_err(|error| error.to_string())?;
        payload.id
    };

    {
        let mut insert = transaction
            .prepare("INSERT INTO terrain_pokemon(id,terrain_id,national_dex,rarity,gender_enabled,male_percent,min_lvl,max_lvl,encounter_weight) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,NULL)")
            .map_err(|error| error.to_string())?;
        for pokemon in payload.pokemon_table {
            insert
                .execute(params![
                    pokemon.id,
                    terrain_id,
                    pokemon.national_dex,
                    pokemon.rarity,
                    pokemon.gender_enabled,
                    pokemon.male_percent,
                    pokemon.min_lvl,
                    pokemon.max_lvl
                ])
                .map_err(|error| error.to_string())?;
        }
    }

    transaction.commit().map_err(|error| error.to_string())?;
    Ok(terrain_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pokemon(id: &str, national_dex: i64) -> TerrainPokemonPayload {
        TerrainPokemonPayload {
            id: id.into(),
            national_dex,
            rarity: "common".into(),
            gender_enabled: true,
            male_percent: None,
            min_lvl: None,
            max_lvl: None,
        }
    }

    fn terrain(id: &str, name: &str, pokemon_table: Vec<TerrainPokemonPayload>) -> TerrainPayload {
        TerrainPayload {
            id: id.into(),
            name: name.into(),
            min_lvl: Some(2),
            max_lvl: Some(8),
            encounter_frequency: "normal".into(),
            shiny_rate: None,
            background_source: None,
            background_cached_path: None,
            schema_version: "1.0".into(),
            created_at: "2026-08-21T00:00:00Z".into(),
            updated_at: "2026-08-21T00:00:00Z".into(),
            pokemon_table,
        }
    }

    #[test]
    fn imports_and_replaces_a_terrain_atomically() {
        let mut connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(include_str!("../migrations/001_initial.sql"))
            .unwrap();

        let id = import_terrain(
            &mut connection,
            terrain("terrain-1", "Rota 1", vec![pokemon("entry-1", 1)]),
            None,
        )
        .unwrap();
        assert_eq!(id, "terrain-1");

        let failed = import_terrain(
            &mut connection,
            terrain(
                "ignored",
                "Alterado",
                vec![pokemon("entry-2", 4), pokemon("entry-3", 4)],
            ),
            Some("terrain-1".into()),
        );
        assert!(failed.is_err());

        let persisted: (String, i64) = connection
            .query_row(
                "SELECT t.name, COUNT(p.id) FROM terrains t JOIN terrain_pokemon p ON p.terrain_id=t.id WHERE t.id='terrain-1' GROUP BY t.id",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(persisted, ("Rota 1".into(), 1));
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![Migration {
        version: 1,
        description: "initial_schema",
        sql: include_str!("../migrations/001_initial.sql"),
        kind: MigrationKind::Up,
    }];

    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .max_file_size(1_000_000)
                .target(Target::new(TargetKind::LogDir {
                    file_name: Some("ptu-encounter-generator".into()),
                }))
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:ptu-encounter-generator.db", migrations)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![import_terrain_atomic])
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o PTU Encounter Generator");
}
