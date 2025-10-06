#!/usr/bin/env ts-node

import fs from "fs";
import path from "path";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

interface ValidationResult {
  path: string;
  ok: boolean;
  expected: any;
  actual: any;
  message: string;
}

/** Lấy value theo path như "orders[0].items[1].sku" hoặc "orders.length" */
function getValueByPath(obj: any, pathStr: string): any {
  if (!obj || !pathStr) return undefined;
  if (pathStr.endsWith(".length")) {
    const basePath = pathStr.replace(/\.length$/, "");
    const val = getValueByPath(obj, basePath);
    return Array.isArray(val) ? val.length : undefined;
  }

  const parts = pathStr.split(".");
  let cur: any = obj;
  for (const part of parts) {
    if (part === "") continue;
    const m = part.match(/^([^\[]+)\[(\d+)\]$/); // e.g. orders[0]
    if (m) {
      const key = m[1];
      const idx = parseInt(m[2], 10);
      cur = cur?.[key]?.[idx];
    } else {
      cur = cur?.[part];
    }
    if (cur === undefined) return undefined;
  }
  return cur;
}

/** Tìm path gốc chứa leftmost "[]", ví dụ template "user.orders[].items[].sku" -> "user.orders" */
function findLeftmostArrayRoot(template: any): string | null {
  if (typeof template === "string") {
    const pos = template.indexOf("[]");
    if (pos !== -1) {
      let s = template.slice(0, pos);
      if (s.endsWith(".")) s = s.slice(0, -1);
      return s;
    }
    return null;
  }
  if (Array.isArray(template)) {
    for (const it of template) {
      const r = findLeftmostArrayRoot(it);
      if (r) return r;
    }
  } else if (typeof template === "object" && template !== null) {
    for (const v of Object.values(template)) {
      const r = findLeftmostArrayRoot(v);
      if (r) return r;
    }
  }
  return null;
}

/** Thay thế **chỉ 1 lần** placeholder "[]" trong tất cả các string của template (deep clone) */
function replaceFirstPlaceholderDeep(template: any, index: number): any {
  if (typeof template === "string") {
    return template.replace(/\[\]/, `[${index}]`);
  } else if (Array.isArray(template)) {
    return template.map((it) => replaceFirstPlaceholderDeep(it, index));
  } else if (typeof template === "object" && template !== null) {
    const o: any = {};
    for (const [k, v] of Object.entries(template)) {
      o[k] = replaceFirstPlaceholderDeep(v, index);
    }
    return o;
  }
  return template;
}

/** So sánh mềm để tránh mismatch "100" vs 100 */
function looselyEqual(a: any, b: any): boolean {
  if (a === undefined || a === null) return b === undefined || b === null;
  if (typeof a === "number" && typeof b === "string") return a == +b;
  if (typeof a === "string" && typeof b === "number") return +a == b;
  if (Array.isArray(a) && Array.isArray(b)) return true;
  if (typeof a === "object" && typeof b === "object") return true;
  return a === b;
}

/** ====== BUILD (EXPORT) ======
 * Sinh object2 từ object1 dựa trên mapping template
 */
function buildTargetFromMapping(source: any, mapTemplate: any): any {
  if (typeof mapTemplate === "string") {
    // IMPORTANT: không xóa "[]". Nếu chuỗi còn "[]", nghĩa là caller (parent array handler)
    // chưa thay index — trong flow bình thường parent sẽ replace trước khi gọi.
    // Nếu vẫn còn "[]", ta cố lấy "non-indexed" fallback (ví dụ lấy first item?) — nhưng ở đây ta trả undefined.
    return getValueByPath(source, mapTemplate);
  }

  if (Array.isArray(mapTemplate)) {
    const template = mapTemplate[0];
    const root = findLeftmostArrayRoot(template);

    // Nếu không có placeholder "[]", coi như array đơn giản mapping#indexed same path
    if (!root) {
      // fallback: try to read source array at base path "", but here we have no base path context
      // safest: return empty array
      return [];
    }

    const sourceArr = getValueByPath(source, root) ?? [];
    if (!Array.isArray(sourceArr)) return [];

    // map each element: replace only the leftmost placeholder per iteration,
    // then recurse — nested placeholders will be replaced in deeper recursion
    return sourceArr.map((_, i) => {
      const replaced = replaceFirstPlaceholderDeep(template, i);
      return buildTargetFromMapping(source, replaced);
    });
  }

  if (typeof mapTemplate === "object" && mapTemplate !== null) {
    const out: any = {};
    for (const [k, v] of Object.entries(mapTemplate)) {
      out[k] = buildTargetFromMapping(source, v);
    }
    return out;
  }

  return mapTemplate;
}

/** ====== VALIDATE (copy of prior logic) ====== **/
function validateMapping(
  source: any,
  target: any,
  mapTemplate: any,
  basePath = ""
): ValidationResult[] {
  const res: ValidationResult[] = [];

  if (typeof mapTemplate === "string") {
    const sourcePath = mapTemplate
      .replace(/\[\]/g, "")
      .replace(/\.\./g, ".")
      .replace(/^\./, "");
    const expected = getValueByPath(source, sourcePath);
    const actual = getValueByPath(target, basePath);
    const ok = looselyEqual(expected, actual);
    res.push({
      path: basePath,
      ok,
      expected,
      actual,
      message: ok
        ? `✔ ${basePath} = ${JSON.stringify(actual)}`
        : `❌ Mismatch at "${basePath}" → expected ${JSON.stringify(
            expected
          )}, got ${JSON.stringify(actual)}`,
    });
    return res;
  }

  if (Array.isArray(mapTemplate)) {
    const template = mapTemplate[0];
    const root = findLeftmostArrayRoot(template);
    const sourceArr = getValueByPath(source, root || "") ?? [];
    const targetArr = getValueByPath(target, basePath) ?? [];

    if (!Array.isArray(sourceArr) || !Array.isArray(targetArr)) {
      res.push({
        path: basePath,
        ok: false,
        expected: "array",
        actual: typeof targetArr,
        message: `❌ Expected array at "${basePath}", got ${typeof targetArr}`,
      });
      return res;
    }

    if (sourceArr.length !== targetArr.length) {
      res.push({
        path: basePath,
        ok: false,
        expected: sourceArr.length,
        actual: targetArr.length,
        message: `❌ Array length mismatch at "${basePath}" → expected ${sourceArr.length}, got ${targetArr.length}`,
      });
      return res;
    }

    for (let i = 0; i < sourceArr.length; i++) {
      const replaced = replaceFirstPlaceholderDeep(template, i);
      res.push(
        ...validateMapping(source, target, replaced, `${basePath}[${i}]`)
      );
    }
    return res;
  }

  if (typeof mapTemplate === "object" && mapTemplate !== null) {
    for (const [key, val] of Object.entries(mapTemplate)) {
      const nextBase = basePath ? `${basePath}.${key}` : key;
      res.push(...validateMapping(source, target, val, nextBase));
    }
  }

  return res;
}

/** ====== CLI ENTRY ====== **/
async function main() {
  const argv = await yargs(hideBin(process.argv))
    .option("source", { type: "string", demandOption: true })
    .option("mapping", { type: "string", demandOption: true })
    .option("target", { type: "string" })
    .option("export", { type: "boolean", default: false })
    .option("output", { type: "string", default: "output.json" })
    .parse();

  const readJSON = (p: string) =>
    JSON.parse(fs.readFileSync(path.resolve(p), "utf8"));

  const source = readJSON(argv.source);
  const mapping = readJSON(argv.mapping);

  if (argv.export) {
    console.log("⚙️  Exporting target object from mapping...");
    const result = buildTargetFromMapping(source, mapping);
    fs.writeFileSync(
      path.resolve(argv.output),
      JSON.stringify(result, null, 2)
    );
    console.log(`✅ Exported mapped target to ${argv.output}`);
    return;
  }

  if (!argv.target) {
    console.error("❌ Missing --target for validation mode");
    process.exit(1);
  }

  const target = readJSON(argv.target);
  console.log("🔍 Validating mapping...\n");

  const results = validateMapping(source, target, mapping);
  const errors = results.filter((r) => !r.ok);
  for (const r of results) console.log(r.message);

  console.log("\n───────────────────────────────");
  if (errors.length === 0) {
    console.log("✅ Mapping is valid!");
    process.exit(0);
  } else {
    console.error(
      `❌ Mapping validation failed with ${errors.length} error(s).`
    );
    for (const e of errors) console.error(` - ${e.message}`);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err: unknown) => {
    const e = err as Error;
    console.error(e?.message ?? err);
    process.exit(1);
  });
}
