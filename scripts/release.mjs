// Release-Skript: hebt die Version in manifest.json, package.json (+ Lockfile) und
// versions.json an, prueft Build und Tests, committet und pusht. Das Veroeffentlichen
// uebernimmt anschliessend .github/workflows/release.yml.
//
// Aufruf:  npm run release -- patch|minor|major|x.y.z [--dry-run]
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const bump = args.find((a) => !a.startsWith("--"));

const fail = (msg) => {
	console.error(`Abbruch: ${msg}`);
	process.exit(1);
};
const out = (cmd) => execSync(cmd, { encoding: "utf8" }).trim();
const run = (cmd) => execSync(cmd, { stdio: "inherit" });

// Einrueckung der Datei beibehalten, damit keine unnoetigen Diffs entstehen.
const readJson = (file) => {
	const text = readFileSync(file, "utf8");
	const indent = text.match(/^([ \t]+)"/m)?.[1] ?? 2;
	return { data: JSON.parse(text), indent };
};
const writeJson = (file, { data, indent }) =>
	writeFileSync(file, JSON.stringify(data, null, indent) + "\n");

if (!bump) fail("Version angeben: patch | minor | major | x.y.z");

const manifest = readJson("manifest.json");
const versions = readJson("versions.json");
const current = manifest.data.version;

let next = bump;
if (["patch", "minor", "major"].includes(bump)) {
	const [maj, min, pat] = current.split(".").map(Number);
	next = bump === "major" ? `${maj + 1}.0.0` : bump === "minor" ? `${maj}.${min + 1}.0` : `${maj}.${min}.${pat + 1}`;
}
if (!/^\d+\.\d+\.\d+$/.test(next)) fail(`Ungueltige Version: ${next}`);
if (next === current) fail(`Version ${next} ist bereits die aktuelle.`);

if (out("git status --porcelain") !== "") fail("Arbeitsverzeichnis nicht sauber, erst committen.");
if (out("git rev-parse --abbrev-ref HEAD") !== "main") fail("Nur auf dem Branch main releasen.");
run("git fetch origin --tags --quiet");
if (out("git rev-list --count HEAD..origin/main") !== "0") fail("Lokaler Stand ist hinter origin/main, erst pullen.");
if (out(`git tag -l ${next}`) !== "") fail(`Tag ${next} existiert bereits.`);

// Aenderungen seit dem letzten Release anzeigen - Grundlage fuer die Wahl von patch/minor/major.
let lastTag = "";
try {
	lastTag = out("git describe --tags --abbrev=0");
} catch {
	// noch kein Tag vorhanden
}
const changes = out(`git log ${lastTag ? `${lastTag}..HEAD` : "HEAD"} --pretty=format:"- %s"`);
console.log(`Aenderungen seit ${lastTag || "Beginn"}:\n${changes || "(keine)"}\n`);

console.log(`Version: ${current} -> ${next} (minAppVersion ${manifest.data.minAppVersion})`);
if (dryRun) process.exit(0);

manifest.data.version = next;
versions.data[next] = manifest.data.minAppVersion;
writeJson("manifest.json", manifest);
writeJson("versions.json", versions);
// aktualisiert package.json und package-lock.json, ohne Commit oder Tag
run(`npm version ${next} --no-git-tag-version --allow-same-version`);

run("npm test");
run("npm run build");

run("git add manifest.json package.json package-lock.json versions.json");
run(`git commit -m "Version ${next}"`);
run("git push origin main");
console.log(`Fertig: ${next} gepusht. GitHub Actions veroeffentlicht das Release.`);
