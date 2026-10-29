// Chinese input: PocketJS's Rime engine (vendor/pocketjs tools/ime: rime.c
// built as /usr/lib/omarchy-pocket/pocket-rime, driven by rime.ts) with its
// pocket_pinyin schema over Arch's Luna Pinyin dictionary. Each request
// evaluates the shell's whole key transcript in a fresh Rime session and
// returns preedit, candidates and what the transcript committed.
//
// The data directory (~/.local/share/omarchy-pocket/ime) is built once with
// rime_deployer (about 14 s on the RK3568), when the daemon starts.
import { existsSync, mkdirSync, copyFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RimeEngine } from "../vendor/pocketjs/tools/ime/rime.ts";
import type { ImeSnapshot } from "../vendor/pocketjs/contracts/spec/ime.ts";

const SYSTEM = "/usr/lib/omarchy-pocket";
const RIME_DATA = "/usr/share/rime-data";
const FILES = ["luna_pinyin.dict.yaml", "essay.txt", "default.yaml", "key_bindings.yaml", "punctuation.yaml", "symbols.yaml"];

/** GB2312 level 1: the 3,755 most common characters, baked when input starts. */
export function commonHanzi(): string {
  const decoder = new TextDecoder("gbk");
  let out = "";
  for (let hi = 0xb0; hi <= 0xd7; hi++)
    for (let lo = 0xa1; lo <= 0xfe && !(hi === 0xd7 && lo > 0xf9); lo++) out += decoder.decode(new Uint8Array([hi, lo]));
  return out;
}

export class Ime {
  private engine: RimeEngine | null = null;
  private preparing: Promise<void> | null = null;

  constructor(private readonly dir: string) {}

  /** Copies the dictionary and schema in and builds them, once. */
  prepare(): Promise<void> {
    this.preparing ??= (async () => {
      if (!existsSync(join(this.dir, "build", "luna_pinyin.table.bin"))) {
        mkdirSync(this.dir, { recursive: true });
        for (const f of FILES) copyFileSync(join(RIME_DATA, f), join(this.dir, f));
        copyFileSync(join(SYSTEM, "ime", "pocket_pinyin.schema.yaml"), join(this.dir, "pocket_pinyin.schema.yaml"));
        writeFileSync(join(this.dir, "default.custom.yaml"), "patch:\n  schema_list:\n    - schema: pocket_pinyin\n");
        if (!existsSync(join(this.dir, "opencc"))) symlinkSync("/usr/share/opencc", join(this.dir, "opencc"));
        const deploy = Bun.spawn(["rime_deployer", "--build", this.dir, this.dir, join(this.dir, "build")], { stdout: "ignore", stderr: "ignore" });
        if ((await deploy.exited) !== 0) throw new Error("rime_deployer could not build the pinyin dictionary");
      }
      // rime.ts runs <data>/pocket-rime
      if (!existsSync(join(this.dir, "pocket-rime"))) symlinkSync(join(SYSTEM, "pocket-rime"), join(this.dir, "pocket-rime"));
      this.engine = new RimeEngine(this.dir);
    })();
    return this.preparing;
  }

  async compose(keys: number[]): Promise<ImeSnapshot> {
    await this.prepare();
    return JSON.parse(await this.engine!.compose(JSON.stringify(keys))) as ImeSnapshot;
  }

  close() {
    this.engine?.close();
  }
}
