import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const required = ["ANDROID_KEYSTORE_PATH", "ANDROID_KEY_ALIAS", "ANDROID_KEYSTORE_PASSWORD", "ANDROID_KEY_PASSWORD"];
for (const name of required) {
  if (!process.env[name]) throw new Error(`Variável obrigatória ausente: ${name}`);
}

const androidRoot = resolve("src-tauri/gen/android");
const gradlePath = resolve(androidRoot, "app/build.gradle.kts");
if (!existsSync(gradlePath)) throw new Error("Projeto Android não foi inicializado pelo Tauri.");

writeFileSync(
  resolve(androidRoot, "keystore.properties"),
  [
    `storeFile=${process.env.ANDROID_KEYSTORE_PATH}`,
    `storePassword=${process.env.ANDROID_KEYSTORE_PASSWORD}`,
    `keyAlias=${process.env.ANDROID_KEY_ALIAS}`,
    `keyPassword=${process.env.ANDROID_KEY_PASSWORD}`,
    "",
  ].join("\n"),
  { mode: 0o600 },
);

let gradle = readFileSync(gradlePath, "utf8");
const marker = "// PTU_ANDROID_SIGNING";
if (!gradle.includes(marker)) {
  const imports = [];
  if (!gradle.includes("import java.io.FileInputStream")) imports.push("import java.io.FileInputStream");
  if (!gradle.includes("import java.util.Properties")) imports.push("import java.util.Properties");
  if (imports.length) gradle = `${imports.join("\n")}\n${gradle}`;
  gradle = gradle.replace(
    "android {",
    `${marker}\nval keystoreProperties = Properties().apply {\n    load(FileInputStream(rootProject.file("keystore.properties")))\n}\n\nandroid {`,
  );
  gradle = gradle.replace(
    /^(\s*)buildTypes\s*\{/m,
    `$1signingConfigs {\n$1    create("release") {\n$1        keyAlias = keystoreProperties["keyAlias"] as String\n$1        keyPassword = keystoreProperties["keyPassword"] as String\n$1        storeFile = file(keystoreProperties["storeFile"] as String)\n$1        storePassword = keystoreProperties["storePassword"] as String\n$1    }\n$1}\n\n$1buildTypes {`,
  );
  gradle = gradle.replace(
    /(getByName\("release"\)\s*\{)/,
    `$1\n            signingConfig = signingConfigs.getByName("release")`,
  );
  if (!gradle.includes('signingConfig = signingConfigs.getByName("release")')) {
    throw new Error("Não foi possível localizar o buildType release no Gradle gerado.");
  }
  writeFileSync(gradlePath, gradle);
}

console.log("Assinatura Android configurada.");
