# PTU Encounter Generator — Especificação Técnica para Implementação

**Status:** Especificação inicial de desenvolvimento  
**Versão:** 1.0  
**Data:** 2026-08-21  
**Objetivo do documento:** servir como fonte de verdade para implementação assistida pelo Codex.

---

## 1. Visão geral

O **PTU Encounter Generator** será uma aplicação local para Windows e Android destinada a gerar encontros aleatórios com Pokémon durante deslocamentos em terrenos previamente cadastrados.

A aplicação deverá:

- funcionar como aplicação Windows distribuível em `.exe`;
- funcionar em Android, com geração de `.apk`;
- utilizar **Tauri 2** para compartilhar a maior parte possível do código entre desktop e mobile;
- operar prioritariamente **offline**;
- manter localmente um catálogo dos Pokémon conhecidos;
- importar terrenos definidos por arquivos JSON;
- permitir configurar probabilidades de encontro e raridade;
- receber uma distância percorrida e calcular a possibilidade de ocorrer um encontro;
- quando houver encontro, sortear Pokémon, nível, sexo, Nature de PTU e condição Shiny;
- tocar um arquivo MP3 configurado pelo usuário quando um encontro ocorrer;
- exibir imagem do Pokémon, utilizando cache local e acessando a internet apenas quando estritamente necessário para obter imagens não armazenadas.

A aplicação **não deve depender de servidor próprio, autenticação ou conexão permanente com a internet**.

---

# 2. Princípios obrigatórios de implementação

Os requisitos abaixo devem ser tratados como **MUST** pelo Codex.

1. **Offline-first:** toda regra de negócio e todo dado necessário para gerar encontros deve funcionar sem internet.
2. **Sem backend remoto obrigatório:** não criar API ou servidor como dependência de execução.
3. **Código compartilhado:** Windows e Android devem utilizar a mesma base Tauri sempre que possível.
4. **Dados versionados:** terrenos, catálogo Pokémon, configurações e schemas devem possuir versão.
5. **Reprodutibilidade:** toda regra probabilística deve estar isolada em funções testáveis.
6. **Configuração explícita:** nenhuma probabilidade de encontro ou raridade deve ficar escondida em código sem poder ser alterada na tela de configurações.
7. **Validação antes de persistir:** JSONs inválidos não podem modificar o banco local.
8. **Persistência local:** usar SQLite para dados estruturados e diretórios de dados da aplicação para mídia/cache.
9. **Compatibilidade mobile:** caminhos absolutos do Windows nunca devem ser persistidos como única referência para arquivos do usuário.
10. **Internet opcional:** falha de rede nunca pode impedir a geração de um encontro já configurado.
11. **Fallback visual:** ausência de sprite/imagem deve exibir placeholder local e não causar erro.
12. **Nenhum dado de PTU deve ser inventado silenciosamente.** Dados que não existam no material-base devem ser marcados como configuração da aplicação ou extensão própria.

---

# 3. Stack recomendada

## 3.1 Aplicação

- **Tauri 2**
- **Rust** para camada nativa e integrações com sistema operacional
- **React**
- **TypeScript**
- **Vite**
- CSS modular ou solução equivalente leve

## 3.2 Persistência

Usar SQLite através do plugin SQL oficial do Tauri.

Banco sugerido:

```text
sqlite:ptu-encounter-generator.db
```

O banco deverá ficar no diretório de dados/configuração da aplicação, nunca ao lado do executável.

## 3.3 Plugins Tauri previstos

- `@tauri-apps/plugin-sql`
- `@tauri-apps/plugin-dialog`
- `@tauri-apps/plugin-fs`

Adicionar outros plugins somente quando houver necessidade técnica clara.

## 3.4 Validação

Preferência:

- TypeScript strict;
- `zod` para validação em runtime;
- JSON Schema versionado para o formato externo de terrenos.

A validação do arquivo de terreno deve ocorrer antes da gravação no SQLite.

---

# 4. Plataformas e artefatos

## 4.1 Windows

Gerar build de produção para Windows.

Artefato esperado:

```text
PTU-Encounter-Generator-Setup-x64.exe
```

Preferencialmente usar bundle NSIS do Tauri.

A aplicação deve funcionar em Windows 10/11 x64.

## 4.2 Android

Gerar APK de produção, inicialmente priorizando ARM64:

```text
PTU-Encounter-Generator-arm64-release.apk
```

Target principal:

```text
aarch64
```

Opcionalmente também poderá existir APK universal ou builds separados por ABI.

---

# 5. Arquitetura lógica

```text
┌───────────────────────────────────────┐
│              React UI                 │
│                                       │
│ Terrain / Encounter / Settings / Dex  │
└─────────────────┬─────────────────────┘
                  │
┌─────────────────▼─────────────────────┐
│         Application Services          │
│                                       │
│ TerrainService                        │
│ EncounterService                      │
│ PokemonCatalogService                 │
│ MediaService                          │
│ SettingsService                       │
└────────────┬───────────────┬──────────┘
             │               │
┌────────────▼──────┐ ┌──────▼─────────┐
│ Domain / RNG      │ │ Tauri adapters │
│                   │ │                │
│ encounter rules   │ │ fs / dialog    │
│ rarity rules      │ │ sqlite         │
│ level rules       │ │ media paths    │
│ nature / shiny    │ │ optional HTTP  │
└───────────────────┘ └────────────────┘
```

A lógica de domínio não deve depender diretamente de componentes React.

---

# 6. Catálogo Pokémon

## 6.1 Estratégia

Usar a **PokéAPI** como fonte inicial para criação/atualização do catálogo, mas **não como dependência de execução da aplicação**.

A PokéAPI fornece informações úteis como:

- número/ID;
- nome;
- espécie;
- tipos;
- geração;
- relação de sexo;
- flags de lendário/mítico;
- sprites e referências de imagem.

O catálogo usado em runtime deverá ser uma cópia local normalizada e versionada.

## 6.2 Observação sobre PTU

A distribuição oficial atual de PTU 1.05 é descrita pelos próprios mantenedores como atualizada até a **Geração 8**.

Consequentemente:

- o catálogo de espécies atuais não deve depender apenas do Pokédex PTU;
- informações gerais de Pokémon posteriores podem vir da PokéAPI ou de overlays mantidos pelo projeto;
- dados especificamente mecânicos de PTU que não existam oficialmente para uma espécie posterior **não devem ser inventados**.

Para o escopo inicial deste aplicativo, o catálogo não precisa conter uma ficha completa de combate PTU. Ele precisa fornecer dados suficientes para geração e apresentação do encontro.

## 6.3 Campos mínimos do catálogo

```ts
interface PokemonCatalogEntry {
  national_dex: number;
  name: string;
  display_name: string;
  generation: number | null;
  types: string[];

  genderless: boolean;
  male_percent: number | null;

  is_legendary: boolean;
  is_mythical: boolean;

  sprite_default_url: string | null;
  sprite_shiny_url: string | null;

  data_source: string;
  data_version: string;
}
```

## 6.4 Atualização do catálogo

Criar script de desenvolvimento:

```text
scripts/sync-pokemon-catalog
```

Fluxo:

1. consultar fonte pública;
2. normalizar dados;
3. comparar com catálogo existente;
4. aplicar overlays manuais;
5. validar;
6. produzir um snapshot;
7. incluir snapshot no pacote da aplicação.

Exemplo:

```text
src/data/pokemon-catalog.v1.json
```

O aplicativo em produção não deve sincronizar automaticamente com a internet.

Uma futura opção manual **“Atualizar catálogo”** poderá ser implementada, mas não pertence ao MVP.

## 6.5 Overlay local

Criar:

```text
src/data/pokemon-catalog.overrides.json
```

Esse arquivo permite corrigir ou acrescentar dados sem modificar o sincronizador.

Prioridade:

```text
override local > snapshot gerado > fonte externa
```

---

# 7. Cache de imagens

O aplicativo deve possuir cache local de sprites.

Fluxo:

1. procurar imagem local;
2. se existir, usar imediatamente;
3. se não existir e houver URL conhecida:
   - tentar download;
   - salvar no cache;
   - usar imagem baixada;
4. se download falhar:
   - mostrar placeholder local;
   - manter o encontro funcional.

Estrutura sugerida:

```text
AppData/
  cache/
    pokemon/
      0001-normal.webp
      0001-shiny.webp
      0132-normal.webp
```

Nunca baixar repetidamente uma imagem já armazenada.

Deve existir nas configurações a ação:

```text
Limpar cache de imagens
```

---

# 8. Modelo de terreno

## 8.1 Formato externo

O formato fornecido originalmente deve ser convertido para JSON válido e versionado.

Formato canônico:

```json
{
  "schema_version": "1.0",
  "background_image_url": "<background_image_url>",
  "terrain": {
    "name": "Example Forest",
    "min_lvl": null,
    "max_lvl": null,
    "encounter_frequency": "normal",
    "shiny_rate": null,
    "pokemon_table": [
      {
        "number": 132,
        "rarity": "common",
        "gender": true,
        "male_odd": null,
        "min_lvl": null,
        "max_lvl": null
      }
    ]
  }
}
```

## 8.2 Enum `encounter_frequency`

Valores permitidos:

```text
uneventful
rare
normal
frequent
eventful
```

Observação: `rare` nesse enum representa **frequência de encontro do terreno** e não deve ser confundido com `rarity` do Pokémon.

## 8.3 Enum `rarity`

Valores permitidos:

```text
common
unusual
rare
super_rare
legendary
```

Internamente usar `snake_case`.

## 8.4 Níveis

Intervalo aceito:

```text
0..100
```

`null` significa “herdar valor”.

Resolução:

```text
pokemon.min_lvl ?? terrain.min_lvl ?? DEFAULT_MIN_LEVEL
pokemon.max_lvl ?? terrain.max_lvl ?? DEFAULT_MAX_LEVEL
```

Defaults sugeridos:

```text
DEFAULT_MIN_LEVEL = 1
DEFAULT_MAX_LEVEL = 100
```

Apesar do schema aceitar `0` por compatibilidade com o requisito de entrada, a tela deve alertar quando nível `0` for usado, pois encontros normais devem preferencialmente começar em nível 1.

Se:

```text
effective_min_lvl > effective_max_lvl
```

o registro deve ser considerado inválido para aquele terreno.

## 8.5 Sexo

Manter compatibilidade com os campos solicitados:

```json
{
  "gender": true,
  "male_odd": 50
}
```

Semântica:

- `gender = false`: Pokémon sem sexo para fins do encontro;
- `gender = true`: sortear sexo;
- `male_odd = 0..100`: sobrescreve a chance de macho;
- `male_odd = null`: usar relação de sexo do catálogo;
- se catálogo indicar `genderless`, resultado final será `genderless`.

Apesar do nome externo `male_odd`, normalizar internamente para:

```ts
male_percent
```

## 8.6 Shiny por terreno

Campo opcional:

```json
"shiny_rate": null
```

Formatos aceitos internamente:

```ts
type ShinyRate =
  | { mode: "probability"; value: number }
  | { mode: "one_in"; value: number };
```

No JSON v1, simplificar para um número `0..1` ou `null`.

Exemplos:

```json
"shiny_rate": 0.000244140625
```

equivale a 1/4096.

`null` significa usar a configuração global.

---

# 9. Persistência de terrenos

Tabelas sugeridas:

```sql
CREATE TABLE terrains (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    min_lvl INTEGER NULL,
    max_lvl INTEGER NULL,
    encounter_frequency TEXT NOT NULL,
    shiny_rate REAL NULL,
    background_source TEXT NULL,
    background_cached_path TEXT NULL,
    schema_version TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE terrain_pokemon (
    id TEXT PRIMARY KEY,
    terrain_id TEXT NOT NULL,
    national_dex INTEGER NOT NULL,
    rarity TEXT NOT NULL,
    gender_enabled INTEGER NOT NULL,
    male_percent REAL NULL,
    min_lvl INTEGER NULL,
    max_lvl INTEGER NULL,
    encounter_weight REAL NULL,
    FOREIGN KEY (terrain_id) REFERENCES terrains(id) ON DELETE CASCADE
);
```

`encounter_weight` fica reservado para pesos individuais futuros.

No MVP:

```text
encounter_weight = null
```

e Pokémon da mesma raridade possuem peso igual.

---

# 10. Importação de terreno

Fluxo obrigatório:

```text
Selecionar JSON
      ↓
Ler arquivo
      ↓
Parse JSON
      ↓
Validar schema
      ↓
Validar regras semânticas
      ↓
Validar Pokémon existentes
      ↓
Mostrar resumo
      ↓
Confirmar importação
      ↓
Transaction SQLite
      ↓
Tentar cachear background
```

## 10.1 Erros que bloqueiam importação

- JSON inválido;
- `schema_version` não suportada;
- `name` ausente;
- enum inválido;
- nível fora de `0..100`;
- `min_lvl > max_lvl`;
- Pokémon sem `number`;
- número inexistente no catálogo;
- `male_odd < 0` ou `male_odd > 100`;
- `shiny_rate < 0` ou `shiny_rate > 1`.

## 10.2 Warnings que não bloqueiam

- `background_image_url` indisponível;
- sprite não encontrado;
- Pokémon sem proporção de sexo conhecida;
- nível 0;
- terreno sem Pokémon em determinada raridade.

---

# 11. Configurações globais

A tela de configurações deve permitir alterar e persistir:

## 11.1 Frequência de encontro

Exemplo de estrutura:

```ts
interface EncounterFrequencySettings {
  uneventful: number;
  rare: number;
  normal: number;
  frequent: number;
  eventful: number;
}
```

Cada número representa probabilidade base por intervalo de distância.

Exemplo inicial sugerido, explicitamente **configuração da aplicação e não regra canônica de PTU**:

```json
{
  "uneventful": 0.05,
  "rare": 0.15,
  "normal": 0.30,
  "frequent": 0.50,
  "eventful": 0.75
}
```

## 11.2 Intervalo de distância

Configuração:

```text
encounter_check_distance
```

Default:

```text
1 km
```

O usuário deve poder escolher unidade de entrada:

```text
m
km
```

Internamente normalizar para metros.

## 11.3 Raridade

Configuração default sugerida:

```json
{
  "common": 60,
  "unusual": 25,
  "rare": 10,
  "super_rare": 4,
  "legendary": 1
}
```

Os valores são pesos relativos.

Não é obrigatório somar exatamente 100; antes do sorteio os pesos serão normalizados.

A UI pode exibir a porcentagem normalizada para facilitar entendimento.

## 11.4 Shiny

Configuração global:

```text
allow_shiny_default = false
global_shiny_rate
```

### Regra importante

PTU 1.05 reconhece Pokémon Shiny mecanicamente, mas a documentação-base consultada não estabelece uma chance canônica de aparecimento aleatório.

Portanto, não tratar uma taxa específica como “regra oficial PTU” sem fonte adicional.

Default técnico recomendado:

```text
1 / 4096
```

representado como:

```text
0.000244140625
```

Essa taxa é **configurável**.

Um terreno pode sobrescrevê-la por `shiny_rate`.

Prioridade:

```text
terrain.shiny_rate
    ?? settings.global_shiny_rate
```

## 11.5 Áudio de encontro

Permitir selecionar arquivo:

```text
.mp3
```

Ao selecionar:

1. abrir file picker nativo;
2. validar extensão/tipo;
3. copiar arquivo para diretório persistente da aplicação;
4. salvar apenas referência interna;
5. oferecer botão para testar áudio.

Estrutura sugerida:

```text
AppData/
  media/
    encounter.mp3
```

No Android, nunca depender permanentemente do `content://` retornado pelo seletor. Copiar o arquivo para armazenamento privado da aplicação.

Configurações:

```ts
interface AudioSettings {
  enabled: boolean;
  encounter_music_path: string | null;
  volume: number; // 0..1
}
```

---

# 12. Algoritmo de encontro por distância

## 12.1 Objetivo

Quanto maior a distância percorrida, maior a chance acumulada de pelo menos um encontro.

No MVP, cada ação **“Percorrer”** gera no máximo **um encontro**.

## 12.2 Fórmula

Se:

```text
p = probabilidade do encounter_frequency por intervalo
d = distância informada
i = encounter_check_distance
n = d / i
```

então:

```text
P(encontro) = 1 - (1 - p)^n
```

Isso equivale à probabilidade acumulada de sucessivas verificações independentes e também funciona para distâncias menores que um intervalo.

Casos especiais:

```text
d <= 0 → P = 0
p <= 0 → P = 0
p >= 1 → P = 1
```

Exemplo:

```text
frequency = normal
p = 0.30
distance = 2 km
interval = 1 km

P = 1 - (1 - 0.30)^2
P = 0.51
```

Chance final: 51%.

## 12.3 Sorteio

Usar uma única chamada da camada RNG:

```ts
roll < encounterProbability
```

A função deve receber RNG por injeção nos testes para tornar casos reproduzíveis.

---

# 13. Algoritmo completo de geração

```text
Usuário escolhe terreno
        ↓
Usuário informa distância
        ↓
App calcula chance acumulada
        ↓
Roll de encontro
   ┌────┴────┐
   │         │
 falha     sucesso
   │         │
 sem       determinar
encontro   candidatos
             ↓
       filtrar entradas válidas
             ↓
       selecionar rarity
             ↓
       selecionar Pokémon
             ↓
       sortear nível
             ↓
       sortear sexo
             ↓
       sortear Nature PTU
             ↓
       sortear Shiny
             ↓
       tocar MP3
             ↓
       exibir encounter card
```

---

# 14. Seleção por raridade

## 14.1 Candidatos

Antes do sorteio, separar somente Pokémon válidos para o terreno.

Uma entrada é elegível se:

- existe no catálogo;
- possui intervalo de nível efetivo válido;
- sua raridade é conhecida.

## 14.2 Bucket

1. identificar raridades que possuem pelo menos um Pokémon elegível;
2. obter pesos configurados;
3. remover buckets vazios;
4. renormalizar pesos;
5. sortear bucket;
6. sortear Pokémon dentro do bucket.

Exemplo:

```text
common      60
unusual     25
rare        10
super_rare   4
legendary    1
```

Se o terreno não possuir Pokémon `legendary`, seu peso é removido e os demais são normalizados.

## 14.3 Mesmo bucket

No MVP:

```text
todos os Pokémon da mesma rarity têm o mesmo peso
```

Extensão futura:

```json
"encounter_weight": 2.5
```

---

# 15. Sorteio de nível

Depois de selecionar a espécie:

```text
effective_min =
  pokemon.min_lvl
  ?? terrain.min_lvl
  ?? DEFAULT_MIN_LEVEL

effective_max =
  pokemon.max_lvl
  ?? terrain.max_lvl
  ?? DEFAULT_MAX_LEVEL
```

Sortear inteiro uniforme inclusivo:

```text
randomInt(effective_min, effective_max)
```

---

# 16. Natures de Pokémon Tabletop United

O aplicativo deve utilizar as **36 Natures de PTU**, e não apenas as 25 Natures dos videogames.

Lista:

| # | Nature | Raise | Lower |
|---:|---|---|---|
| 1 | Cuddly | HP | Attack |
| 2 | Distracted | HP | Defense |
| 3 | Proud | HP | Special Attack |
| 4 | Decisive | HP | Special Defense |
| 5 | Patient | HP | Speed |
| 6 | Desperate | Attack | HP |
| 7 | Lonely | Attack | Defense |
| 8 | Adamant | Attack | Special Attack |
| 9 | Naughty | Attack | Special Defense |
| 10 | Brave | Attack | Speed |
| 11 | Stark | Defense | HP |
| 12 | Bold | Defense | Attack |
| 13 | Impish | Defense | Special Attack |
| 14 | Lax | Defense | Special Defense |
| 15 | Relaxed | Defense | Speed |
| 16 | Curious | Special Attack | HP |
| 17 | Modest | Special Attack | Attack |
| 18 | Mild | Special Attack | Defense |
| 19 | Rash | Special Attack | Special Defense |
| 20 | Quiet | Special Attack | Speed |
| 21 | Dreamy | Special Defense | HP |
| 22 | Calm | Special Defense | Attack |
| 23 | Gentle | Special Defense | Defense |
| 24 | Careful | Special Defense | Special Attack |
| 25 | Sassy | Special Defense | Speed |
| 26 | Skittish | Speed | HP |
| 27 | Timid | Speed | Attack |
| 28 | Hasty | Speed | Defense |
| 29 | Jolly | Speed | Special Attack |
| 30 | Naive | Speed | Special Defense |
| 31 | Composed | HP | HP |
| 32 | Hardy | Attack | Attack |
| 33 | Docile | Defense | Defense |
| 34 | Bashful | Special Attack | Special Attack |
| 35 | Quirky | Special Defense | Special Defense |
| 36 | Serious | Speed | Speed |

PTU sugere geração equivalente a duas rolagens de d6:

```text
primeiro d6 = Stat aumentado
segundo d6 = Stat reduzido
```

Mapeamento:

```text
1 = HP
2 = Attack
3 = Defense
4 = Special Attack
5 = Special Defense
6 = Speed
```

Como existem 36 combinações equiprováveis, a aplicação pode implementar:

```ts
randomInt(1, 36)
```

ou dois d6 independentes, desde que o resultado estatístico seja equivalente.

Preferir implementação por dois d6 para manter transparência com a regra de PTU.

---

# 17. Sorteio de sexo

Ordem:

```text
catalog.genderless == true
    → genderless

terrainPokemon.gender == false
    → genderless

terrainPokemon.male_percent != null
    → usar override

catalog.male_percent != null
    → usar catálogo

caso contrário
    → unknown
```

Para chance conhecida:

```text
roll < male_percent / 100
```

Resultados internos:

```ts
type EncounterGender =
  | "male"
  | "female"
  | "genderless"
  | "unknown";
```

---

# 18. Sorteio de Shiny

O checkbox na tela de encontro controla se o sorteio será realizado.

```text
allowShiny == false
    → shiny = false
```

Quando habilitado:

```text
rate =
  terrain.shiny_rate
  ?? settings.global_shiny_rate
```

Então:

```text
shiny = random() < rate
```

Se o Pokémon for Shiny:

1. tentar sprite shiny em cache;
2. tentar `sprite_shiny_url`;
3. se inexistente, usar sprite normal + indicador visual “SHINY”;
4. nunca cancelar o encontro por falta de imagem shiny.

---

# 19. Música de encontro

A música deve tocar **somente após um roll de encontro bem-sucedido**.

Sequência recomendada:

```text
roll sucesso
→ gerar resultado completamente
→ iniciar reprodução do MP3
→ mostrar card/modal do encontro
```

Não bloquear a UI esperando fim da música.

A interface deve oferecer:

- play/pause;
- controle de volume;
- opção “não tocar novamente nesta sessão”;
- botão de fechar resultado.

Se não houver MP3 configurado, encontro continua normalmente.

---

# 20. Background do terreno

`background_image_url` é opcional.

Ao importar:

1. salvar URL original;
2. se houver rede, tentar baixar uma vez;
3. persistir cópia local;
4. usar cópia local nas próximas execuções.

Prioridade:

```text
background_cached_path
> background_image_url quando online
> background padrão local
```

Falha de download não bloqueia importação.

Extensão futura recomendada:

```json
"background_image_path": "..."
```

para permitir imagens fornecidas localmente sem internet.

---

# 21. Telas

## 21.1 Home

Exibir:

- botão **Novo percurso**;
- terreno selecionado;
- último encontro;
- atalhos para Terrenos e Configurações.

## 21.2 Gerar encontro

Campos:

```text
Terreno                  [select]
Distância                [number]
Unidade                  [m | km]
Permitir Shiny           [checkbox]
```

Informações auxiliares:

```text
Frequência do terreno
Chance estimada de encontro
Quantidade de Pokémon elegíveis
```

Botão:

```text
PERCORRER
```

Resultados possíveis:

```text
Nenhum encontro ocorreu.
```

ou card com:

- imagem;
- número nacional;
- nome;
- nível;
- sexo;
- Nature;
- tipos;
- raridade;
- badge Shiny;
- nome do terreno.

## 21.3 Terrenos

Funções:

- listar;
- visualizar;
- importar JSON;
- substituir terreno;
- excluir;
- visualizar tabela de Pokémon;
- validar terreno novamente.

## 21.4 Configurações

Seções:

### Encontros
- percentuais por `encounter_frequency`;
- intervalo de distância;
- unidade padrão.

### Raridade
- pesos de cada rarity.

### Shiny
- taxa global;
- checkbox default.

### Áudio
- selecionar MP3;
- remover MP3;
- testar;
- volume.

### Dados
- versão do catálogo Pokémon;
- limpar cache de imagens;
- exportar configurações;
- restaurar defaults.

---

# 22. Modelo do resultado de encontro

```ts
interface EncounterResult {
  id: string;
  created_at: string;

  terrain_id: string;
  terrain_name: string;

  travelled_distance_m: number;
  encounter_probability: number;

  national_dex: number;
  pokemon_name: string;
  display_name: string;
  types: string[];

  rarity:
    | "common"
    | "unusual"
    | "rare"
    | "super_rare"
    | "legendary";

  level: number;

  gender:
    | "male"
    | "female"
    | "genderless"
    | "unknown";

  nature: {
    id: number;
    name: string;
    raises: string;
    lowers: string;
  };

  shiny: boolean;

  image_cached_path: string | null;
  image_remote_url: string | null;
}
```

---

# 23. Histórico

Recomendado incluir desde o MVP uma tabela simples de histórico:

```sql
CREATE TABLE encounter_history (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    terrain_id TEXT NOT NULL,
    travelled_distance_m REAL NOT NULL,
    encounter_probability REAL NOT NULL,
    national_dex INTEGER NOT NULL,
    pokemon_name TEXT NOT NULL,
    rarity TEXT NOT NULL,
    level INTEGER NOT NULL,
    gender TEXT NOT NULL,
    nature_id INTEGER NOT NULL,
    nature_name TEXT NOT NULL,
    shiny INTEGER NOT NULL
);
```

A geração do encontro deve ser concluída mesmo se a gravação do histórico falhar; nesse caso registrar erro local.

---

# 24. Estrutura sugerida do projeto

```text
ptu-encounter-generator/
├─ docs/
│  └─ TECHNICAL_SPEC.md
│
├─ scripts/
│  └─ sync-pokemon-catalog/
│
├─ src/
│  ├─ app/
│  ├─ components/
│  ├─ pages/
│  │  ├─ Home/
│  │  ├─ Encounter/
│  │  ├─ Terrains/
│  │  └─ Settings/
│  │
│  ├─ domain/
│  │  ├─ encounter/
│  │  │  ├─ calculateEncounterProbability.ts
│  │  │  ├─ rollEncounter.ts
│  │  │  ├─ selectRarity.ts
│  │  │  ├─ selectPokemon.ts
│  │  │  ├─ rollLevel.ts
│  │  │  ├─ rollGender.ts
│  │  │  ├─ rollNature.ts
│  │  │  └─ rollShiny.ts
│  │  │
│  │  ├─ terrain/
│  │  └─ pokemon/
│  │
│  ├─ services/
│  │  ├─ TerrainService.ts
│  │  ├─ EncounterService.ts
│  │  ├─ PokemonCatalogService.ts
│  │  ├─ SettingsService.ts
│  │  └─ MediaService.ts
│  │
│  ├─ infrastructure/
│  │  ├─ db/
│  │  ├─ files/
│  │  └─ cache/
│  │
│  ├─ data/
│  │  ├─ pokemon-catalog.v1.json
│  │  ├─ pokemon-catalog.overrides.json
│  │  └─ ptu-natures.json
│  │
│  ├─ schemas/
│  │  └─ terrain.schema.json
│  │
│  └─ types/
│
├─ src-tauri/
│  ├─ migrations/
│  └─ src/
│
├─ tests/
│  ├─ unit/
│  ├─ integration/
│  └─ fixtures/
│
└─ package.json
```

---

# 25. Separação de responsabilidades

## TypeScript

Concentrar:

- regras de encontro;
- probabilidades;
- seleção ponderada;
- Nature;
- nível;
- sexo;
- Shiny;
- validação de DTO;
- view models.

## Rust/Tauri

Concentrar:

- acesso nativo a arquivos;
- persistência/integração;
- paths seguros;
- operações específicas do SO;
- comandos que não possam ser realizados de forma portável no frontend.

Não migrar regra probabilística para Rust sem necessidade.

---

# 26. RNG e testes

Criar abstração:

```ts
export interface RandomSource {
  next(): number; // >= 0 e < 1
  intInclusive(min: number, max: number): number;
}
```

Produção:

```text
SecureRandomSource
```

Testes:

```text
SequenceRandomSource
```

Exemplo:

```ts
new SequenceRandomSource([0.10, 0.50, 0.99])
```

Isso permite testar exatamente:

- sucesso/falha de encontro;
- bucket;
- espécie;
- sexo;
- shiny.

Não utilizar `Math.random()` diretamente espalhado pelo projeto.

---

# 27. Testes unitários mínimos

## Probabilidade por distância

Testar:

```text
distance = 0
p = 0
p = 1
distance < interval
distance = interval
distance > interval
```

## Raridade

Testar:

- todos os buckets presentes;
- bucket vazio;
- apenas um bucket;
- pesos não somando 100;
- peso zero;
- configuração inválida.

## Nível

Testar:

- herança do terreno;
- override do Pokémon;
- limites inclusivos;
- intervalo inválido.

## Sexo

Testar:

- genderless;
- male 100%;
- male 0%;
- override;
- fallback catálogo;
- unknown.

## Nature

Testar:

- 36 resultados possíveis;
- resultado de cada combinação de d6;
- Natures neutras.

## Shiny

Testar:

- checkbox desativado;
- taxa 0;
- taxa 1;
- override do terreno;
- fallback global.

## Importação JSON

Testar:

- fixture válida;
- JSON quebrado;
- enum inválido;
- Pokémon inexistente;
- nível inválido;
- male_odd inválido;
- shiny_rate inválido.

---

# 28. Testes de integração mínimos

## Windows

- importar JSON;
- selecionar MP3;
- fechar aplicativo;
- abrir novamente;
- verificar persistência;
- gerar encontro offline;
- reproduzir MP3;
- usar sprite já cacheado.

## Android

- importar JSON pelo seletor de arquivos;
- selecionar MP3 via Android document picker;
- copiar mídia para armazenamento privado;
- reiniciar aplicativo;
- manter arquivo acessível;
- gerar encontro sem internet;
- reproduzir áudio;
- exibir imagem cacheada.

---

# 29. Comportamento offline

Com modo avião ou cabo de rede desconectado:

**deve funcionar:**

- abrir aplicação;
- listar terrenos;
- importar JSON local;
- editar configurações;
- calcular encontro;
- sortear Pokémon;
- sortear Nature;
- sortear sexo;
- sortear Shiny;
- tocar MP3 local;
- mostrar sprites já cacheados;
- registrar histórico.

**pode falhar de forma silenciosamente recuperável:**

- baixar sprite ainda não cacheado;
- baixar background remoto ainda não cacheado.

A UI deve informar:

```text
Imagem indisponível offline.
```

sem exibir erro técnico ao usuário.

---

# 30. Segurança e permissões

O aplicativo deve solicitar apenas as permissões necessárias.

Não solicitar:

- localização;
- câmera;
- microfone;
- contatos;
- notificações;

a menos que uma feature futura realmente precise delas.

Arquivos selecionados devem ser copiados para escopo privado da aplicação quando sua disponibilidade futura não puder ser garantida.

Não executar conteúdo importado.

JSON deve ser tratado exclusivamente como dado.

---

# 31. Migrações

Toda alteração de banco deve usar migrations.

Exemplo:

```text
001_initial.sql
002_encounter_history.sql
003_add_terrain_shiny_rate.sql
```

Nunca depender de recriar banco para atualização de versão.

---

# 32. Logs

Manter logs locais para diagnóstico:

```text
INFO  application_started
INFO  terrain_imported
INFO  encounter_generated
WARN  remote_image_unavailable
ERROR terrain_import_failed
ERROR database_write_failed
```

Não registrar conteúdo binário de MP3/imagens.

Não registrar dados pessoais desnecessários.

---

# 33. UX para erros

Mensagens devem ser compreensíveis.

Evitar:

```text
SQLITE_CONSTRAINT_FOREIGNKEY
```

Preferir:

```text
Não foi possível importar o terreno porque o Pokémon #99999 não existe no catálogo local.
```

Para JSON:

```text
Arquivo inválido:
terrain.pokemon_table[3].male_odd deve estar entre 0 e 100.
```

---

# 34. Critérios de aceite do MVP

O MVP estará concluído somente quando todos os itens abaixo forem verdadeiros.

- [ ] Build Windows gera `.exe`.
- [ ] Build Android gera `.apk` ARM64.
- [ ] Aplicação inicia sem internet.
- [ ] Catálogo Pokémon local é carregado sem chamada HTTP.
- [ ] É possível importar um terreno JSON válido.
- [ ] JSON inválido informa erros sem corromper dados existentes.
- [ ] Terrenos importados persistem após reiniciar.
- [ ] Usuário configura percentuais das cinco frequências.
- [ ] Usuário configura pesos das cinco raridades.
- [ ] Usuário configura intervalo de distância.
- [ ] Usuário seleciona um terreno.
- [ ] Usuário informa distância.
- [ ] Aplicação calcula probabilidade acumulada.
- [ ] Roll pode resultar em “sem encontro”.
- [ ] Em sucesso, Pokémon é sorteado entre entradas elegíveis.
- [ ] Raridade respeita pesos configurados.
- [ ] Nível respeita terreno e override individual.
- [ ] Sexo respeita `gender`, `male_odd` e catálogo.
- [ ] Nature usa a tabela de 36 Natures de PTU.
- [ ] Checkbox Shiny desativado impede Shiny.
- [ ] Checkbox Shiny ativado usa a taxa configurada.
- [ ] `shiny_rate` do terreno sobrescreve taxa global.
- [ ] MP3 configurado toca em encontro bem-sucedido.
- [ ] Sem MP3 configurado o encontro funciona.
- [ ] Sprite é carregado do cache quando disponível.
- [ ] Falha de internet não cancela encontro.
- [ ] Resultado é salvo no histórico.
- [ ] Regras probabilísticas possuem testes unitários.

---

# 35. Fora do escopo do MVP

Não implementar inicialmente:

- cadastro/login;
- sincronização em nuvem;
- servidor web;
- multiplayer;
- GPS real;
- leitura automática da distância percorrida;
- combate;
- cálculo completo de ficha PTU;
- captura;
- moveset;
- abilities aleatórias;
- distribuição de stat points;
- itens carregados;
- múltiplos encontros em um único percurso;
- editor visual completo de terreno.

Esses recursos poderão ser adicionados depois sem alterar a base do gerador.

---

# 36. Evoluções futuras previstas

A arquitetura deve deixar espaço para:

1. editor visual de terrenos;
2. exportação de terreno JSON;
3. múltiplos arquivos MP3 por terreno;
4. música específica por raridade;
5. música especial para Shiny;
6. encontro com múltiplos Pokémon;
7. grupos/swarms;
8. clima;
9. horário do dia;
10. estação;
11. modificadores por tipo;
12. modificadores por Habitat;
13. moveset PTU;
14. abilities;
15. ficha PTU completa;
16. tabela de loot;
17. geração por seed;
18. sincronização manual do catálogo;
19. packs comunitários de Pokémon posteriores à Gen 8.

---

# 37. Ordem recomendada de implementação para o Codex

## Fase 1 — Bootstrap

1. criar Tauri 2 + React + TypeScript;
2. configurar Windows;
3. inicializar Android;
4. adicionar plugins;
5. configurar SQLite;
6. configurar migrations.

## Fase 2 — Domínio

1. tipos;
2. RNG;
3. frequência;
4. raridade;
5. nível;
6. sexo;
7. Natures;
8. Shiny;
9. testes unitários.

## Fase 3 — Dados

1. catálogo local;
2. sincronizador;
3. overrides;
4. schema do terreno;
5. importador;
6. SQLite.

## Fase 4 — UI

1. Home;
2. Terrenos;
3. Encounter;
4. Settings;
5. resultado;
6. histórico.

## Fase 5 — Mídia

1. seletor MP3;
2. cópia local;
3. player;
4. background;
5. cache de sprites.

## Fase 6 — Builds e validação

1. testes Windows;
2. build `.exe`;
3. testes Android;
4. build ARM64 `.apk`;
5. teste offline completo.

---

# 38. Instruções específicas ao Codex

Ao implementar a partir deste documento:

1. não alterar regras de negócio por conveniência sem atualizar esta especificação;
2. trabalhar em incrementos pequenos;
3. criar testes antes ou junto da lógica probabilística;
4. não introduzir backend remoto;
5. não fazer requests HTTP durante a geração do encontro;
6. requests de imagem devem ocorrer fora da lógica de decisão;
7. não bloquear resultado esperando download de imagem;
8. não utilizar dados de Pokémon obtidos de forma não rastreável;
9. adicionar fonte e versão aos snapshots de dados;
10. manter JSON externo retrocompatível dentro da mesma major version;
11. criar migration para qualquer mudança persistente;
12. não armazenar mídia dentro do SQLite;
13. não duplicar regra de encontro em React e Rust;
14. manter funções de domínio puras sempre que possível;
15. executar testes antes de considerar uma etapa concluída.

---

# 39. Decisões técnicas consolidadas

| Tema | Decisão |
|---|---|
| Framework | Tauri 2 |
| Frontend | React + TypeScript |
| Nativo | Rust |
| Banco | SQLite |
| Backend remoto | Não |
| Fonte inicial Pokémon | PokéAPI |
| Runtime Pokémon | Snapshot local |
| Dados PTU atuais | Overlay próprio quando necessário |
| Natures | 36 Natures de PTU |
| Imagens | Lazy download + cache |
| Internet | Opcional e principalmente para imagens |
| Terrain | Importação JSON |
| Encounter | Máximo 1 por percurso no MVP |
| Distância | Probabilidade acumulada |
| Rarity | Bucket ponderado |
| Shiny | Configurável; override por terreno |
| Áudio | MP3 copiado para AppData |
| Windows | `.exe` |
| Android | `.apk` ARM64 |

---

# 40. Fontes técnicas consultadas

## Tauri

Tauri 2 — plataforma cross-platform para Windows e Android:

https://tauri.app/

Pré-requisitos e mobile targets:

https://v2.tauri.app/start/prerequisites/

Plugin SQL:

https://v2.tauri.app/plugin/sql/

Plugin File System:

https://v2.tauri.app/plugin/file-system/

Plugin Dialog:

https://v2.tauri.app/plugin/dialog/

Build Android / APK:

https://v2.tauri.app/distribute/google-play/

## Pokémon

PokéAPI:

https://pokeapi.co/

Documentação:

https://pokeapi.co/docs/v2

Sobre a origem dos dados:

https://pokeapi.co/about

## Pokémon Tabletop United

Downloads e recursos oficiais de PTU:

https://pokemontabletop.com/downloads-and-resources/

Useful Charts / Nature Chart de PTU 1.05:

https://peda.net/p/josajoki/fista/ohjeet/ptu/useful-charts

---

# 41. Observações sobre licenciamento e propriedade intelectual

Pokémon é propriedade intelectual de seus respectivos detentores.

Este projeto deve ser tratado como ferramenta de apoio não oficial.

Evitar incorporar assets protegidos de forma desnecessária ao instalador.

A estratégia preferida é:

- armazenar metadados;
- utilizar referências de sprites permitidas pela fonte;
- fazer cache apenas quando necessário;
- documentar origem dos dados;
- não afirmar afiliação ou endosso por Nintendo, The Pokémon Company ou Game Freak.

PTU também é um projeto de fãs e não deve ser apresentado como produto oficial da franquia Pokémon.

---

# 42. Resultado esperado

Ao final do MVP, o fluxo principal deverá ser:

```text
abrir app
→ escolher terreno
→ informar 3 km
→ marcar/desmarcar Shiny
→ clicar Percorrer
→ app calcula chance
→ app decide se houve encontro
→ se não houve, informa usuário
→ se houve:
     toca MP3
     sorteia rarity
     sorteia Pokémon
     sorteia nível
     sorteia sexo
     sorteia Nature PTU
     sorteia Shiny
     mostra imagem
     salva histórico
```

Todo esse fluxo, exceto a obtenção opcional de uma imagem ainda não cacheada, deve funcionar **sem conexão com a internet**.
