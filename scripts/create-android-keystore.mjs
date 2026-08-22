import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const keystoreDir = resolve("keystores");
const keystorePath = resolve(keystoreDir, "android-release.jks");
const environmentPath = resolve(".env.android");
if (existsSync(keystorePath) || existsSync(environmentPath)) {
  throw new Error("A chave ou o arquivo .env.android já existe; nada foi sobrescrito.");
}

mkdirSync(keystoreDir, { recursive: true });
const password = randomBytes(32).toString("base64url");
const alias = "ptu-encounter-generator";
const javaRoots = [process.env.JAVA_HOME, "C:/Program Files/Eclipse Adoptium"].filter(Boolean);
const installedJava = javaRoots.flatMap((root) => {
  const direct = resolve(root, "bin/keytool.exe");
  if (existsSync(direct)) return [direct];
  if (!existsSync(root)) return [];
  return readdirSync(root).map((directory) => resolve(root, directory, "bin/keytool.exe")).filter(existsSync);
});
const keytool = process.platform === "win32" ? installedJava[0] ?? "keytool.exe" : "keytool";
const result = spawnSync(
  keytool,
  [
    "-genkeypair", "-noprompt", "-keystore", keystorePath, "-storetype", "PKCS12",
    "-alias", alias, "-keyalg", "RSA", "-keysize", "4096", "-validity", "10000",
    "-storepass", password, "-keypass", password,
    "-dname", "CN=PTU Encounter Generator, OU=Private Distribution, O=PTU Group, C=BR",
  ],
  { encoding: "utf8" },
);
if (result.status !== 0) throw new Error(result.stderr || result.error?.message || "keytool falhou");

writeFileSync(
  environmentPath,
  [
    "ANDROID_KEYSTORE_PATH=/run/secrets/android-release.jks",
    `ANDROID_KEY_ALIAS=${alias}`,
    `ANDROID_KEYSTORE_PASSWORD=${password}`,
    `ANDROID_KEY_PASSWORD=${password}`,
    "",
  ].join("\n"),
  { mode: 0o600 },
);

console.log("Chave criada em keystores/android-release.jks e credenciais em .env.android.");
