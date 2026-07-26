import esbuild from "esbuild";
import fs from "fs";
import path from "path";

const prod = process.argv[2] === "production";
const distDir = "dist";
const vaultPluginDir = "C:\\Users\\jesud\\OneDrive\\Documentos\\Obsidian Vault\\.obsidian\\plugins\\dbml-obsidian";

function copyToVault() {
	if (!fs.existsSync(vaultPluginDir)) {
		fs.mkdirSync(vaultPluginDir, { recursive: true });
	}
	fs.copyFileSync(path.join(distDir, "main.js"), path.join(vaultPluginDir, "main.js"));
	fs.copyFileSync(path.join(distDir, "manifest.json"), path.join(vaultPluginDir, "manifest.json"));
	fs.copyFileSync(path.join(distDir, "styles.css"), path.join(vaultPluginDir, "styles.css"));
	console.log("✓ Copied to vault");
}

if (!fs.existsSync(distDir)) {
	fs.mkdirSync(distDir, { recursive: true });
}

fs.copyFileSync("manifest.json", path.join(distDir, "manifest.json"));
fs.copyFileSync("styles.css", path.join(distDir, "styles.css"));

if (prod) {
	esbuild
		.build({
			entryPoints: ["src/main.ts"],
			bundle: true,
			external: [
				"obsidian",
				"electron",
				"@codemirror/autocomplete",
				"@codemirror/collab",
				"@codemirror/commands",
				"@codemirror/language",
				"@codemirror/lint",
				"@codemirror/search",
				"@codemirror/state",
				"@codemirror/view",
				"@lezer/common",
				"@lezer/highlight",
				"@lezer/lr",
			],
			format: "cjs",
			target: "es2018",
			logLevel: "info",
			sourcemap: false,
			treeShaking: true,
			outfile: "dist/main.js",
			minify: true,
			footer: {
				js: `module.exports = module.exports.default;`,
			},
		})
		.then(() => {
			copyToVault();
		})
		.catch(() => process.exit(1));
} else {
	const ctx = await esbuild.context({
		entryPoints: ["src/main.ts"],
		bundle: true,
		external: [
			"obsidian",
			"electron",
			"@codemirror/autocomplete",
			"@codemirror/collab",
			"@codemirror/commands",
			"@codemirror/language",
			"@codemirror/lint",
			"@codemirror/search",
			"@codemirror/state",
			"@codemirror/view",
			"@lezer/common",
			"@lezer/highlight",
			"@lezer/lr",
		],
		format: "cjs",
		target: "es2018",
		logLevel: "info",
		sourcemap: "inline",
		treeShaking: true,
		outfile: "dist/main.js",
		footer: {
			js: `module.exports = module.exports.default;`,
		},
	});

	await ctx.rebuild();
	copyToVault();
	await ctx.watch();
	console.log("Watching for changes... (Ctrl+C to stop)");
}
