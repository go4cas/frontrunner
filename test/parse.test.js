import { describe, expect, test } from "bun:test";
import { parseCSV, detectDelimiter, detectShape, normalize, parseValue, temporalType, sniffJSONDataset, jsonToTable } from "../src/parse.js";

describe("delimiter detection", () => {
  test("comma", () => expect(detectDelimiter("a,b,c\n1,2,3")).toBe(","));
  test("semicolon", () => expect(detectDelimiter("a;b;c\n1;2;3")).toBe(";"));
  test("tab", () => expect(detectDelimiter("a\tb\tc\n1\t2\t3")).toBe("\t"));
  test("quoted commas don't fool semicolon files", () =>
    expect(detectDelimiter('"a,x";b;c\n1;2;3')).toBe(";"));
});

describe("parseCSV", () => {
  test("basic", () => {
    const { headers, rows } = parseCSV("a,b\n1,2\n3,4");
    expect(headers).toEqual(["a", "b"]);
    expect(rows).toEqual([["1", "2"], ["3", "4"]]);
  });
  test("quoted fields with commas and escaped quotes", () => {
    const { rows } = parseCSV('a,b\n"hello, world","she said ""hi"""');
    expect(rows[0]).toEqual(['hello, world', 'she said "hi"']);
  });
  test("newlines inside quotes", () => {
    const { rows } = parseCSV('a,b\n"line1\nline2",x');
    expect(rows[0][0]).toBe("line1\nline2");
  });
  test("CRLF and trailing newline", () => {
    const { rows } = parseCSV("a,b\r\n1,2\r\n");
    expect(rows).toEqual([["1", "2"]]);
  });
  test("BOM stripped", () => {
    const { headers } = parseCSV("\uFEFFyear,country\n1960,China");
    expect(headers[0]).toBe("year");
  });
});

describe("parseValue", () => {
  test("thousands separators", () => expect(parseValue("1,400,000")).toBe(1400000));
  test("currency", () => expect(parseValue("$3.2")).toBe(3.2));
  test("percent", () => expect(parseValue("45%")).toBe(45));
  test("scientific", () => expect(parseValue("1.4e9")).toBe(1.4e9));
  test("garbage is NaN", () => expect(Number.isNaN(parseValue("n/a"))).toBe(true));
  test("empty is NaN", () => expect(Number.isNaN(parseValue(""))).toBe(true));
});

describe("temporalType", () => {
  test("year", () => expect(temporalType("1987")).toBe("year"));
  test("ym", () => expect(temporalType("2020-03")).toBe("ym"));
  test("ymd", () => expect(temporalType("2020-03-15")).toBe("ymd"));
  test("not temporal", () => expect(temporalType("Q1")).toBe(null));
});

const LONG = `year,country,population
1960,China,667000000
1960,India,451000000
1970,China,818000000
1970,India,555000000`;

const WIDE = `country,1960,1970
China,667000000,818000000
India,451000000,555000000`;

describe("shape detection", () => {
  test("long format", () => {
    const { headers, rows } = parseCSV(LONG);
    const info = detectShape(headers, rows);
    expect(info.shape).toBe("long");
    expect(info.mapping).toEqual({ time: "year", entity: "country", value: "population", image: null, category: null, color: null });
  });
  test("wide format", () => {
    const { headers, rows } = parseCSV(WIDE);
    const info = detectShape(headers, rows);
    expect(info.shape).toBe("wide");
    expect(info.mapping.entity).toBe("country");
    expect(info.mapping.periods).toEqual(["1960", "1970"]);
  });
});

describe("normalize", () => {
  test("long and wide produce identical models", () => {
    const a = (() => {
      const { headers, rows } = parseCSV(LONG);
      return normalize(headers, rows, detectShape(headers, rows));
    })();
    const b = (() => {
      const { headers, rows } = parseCSV(WIDE);
      return normalize(headers, rows, detectShape(headers, rows));
    })();
    expect(a.periods).toEqual(b.periods);
    expect(a.entities).toEqual(b.entities);
    expect(Array.from(a.values)).toEqual(Array.from(b.values));
  });
  test("missing cells become NaN", () => {
    const csv = "year,country,pop\n1960,China,10\n1970,China,20\n1970,India,5";
    const { headers, rows } = parseCSV(csv);
    const ds = normalize(headers, rows, detectShape(headers, rows));
    const idx = ds.periods.indexOf("1960") * ds.entities.length + ds.entities.indexOf("India");
    expect(Number.isNaN(ds.values[idx])).toBe(true);
  });
  test("negative values clamp with warning", () => {
    const csv = "year,country,pop\n1960,China,-5\n1970,China,20";
    const { headers, rows } = parseCSV(csv);
    const ds = normalize(headers, rows, { shape: "long", mapping: { time: "year", entity: "country", value: "pop" } });
    expect(ds.values[0]).toBe(0);
    expect(ds.warnings.some((w) => w.includes("clamped"))).toBe(true);
  });
  test("periods sort numerically", () => {
    const csv = "year,country,pop\n2000,X,1\n1960,X,2\n1980,X,3";
    const { headers, rows } = parseCSV(csv);
    const ds = normalize(headers, rows, { shape: "long", mapping: { time: "year", entity: "country", value: "pop" } });
    expect(ds.periods).toEqual(["1960", "1980", "2000"]);
  });
});


describe("daily / sub-year periods", () => {
  const days = Array.from({ length: 30 }, (_, i) => `2026-01-${String(i + 1).padStart(2, "0")}`);

  test("long format: 30 daily periods detect at full confidence and sort chronologically", () => {
    const rows = days.flatMap((d) => [`${d},AlphaCo,${100}`, `${d},BetaCo,${80}`]);
    const csv = "date,company,value\n" + rows.join("\n");
    const { headers, rows: parsedRows } = parseCSV(csv);
    const info = detectShape(headers, parsedRows);
    expect(info.confidence).toBe(1);
    const ds = normalize(headers, parsedRows, info);
    expect(ds.periods.length).toBe(30);
    expect(ds.periods[0]).toBe("2026-01-01");
    expect(ds.periods[29]).toBe("2026-01-30");
  });

  test("wide format: 30 daily-dated columns detect and sort chronologically", () => {
    const header = "company," + days.join(",");
    const alpha = "AlphaCo," + days.map(() => 100).join(",");
    const csv = header + "\n" + alpha;
    const { headers, rows } = parseCSV(csv);
    const info = detectShape(headers, rows);
    expect(info.shape).toBe("wide");
    expect(info.mapping.periods.length).toBe(30);
    const ds = normalize(headers, rows, info);
    expect(ds.periods[0]).toBe("2026-01-01");
    expect(ds.periods[29]).toBe("2026-01-30");
  });
});

describe("JSON dataset input", () => {
  test("sniffJSONDataset accepts an array of flat objects", () => {
    const arr = sniffJSONDataset('[{"a":1,"b":2}]');
    expect(arr).toEqual([{ a: 1, b: 2 }]);
  });
  test("sniffJSONDataset rejects a project envelope, arrays of arrays, and non-JSON", () => {
    expect(sniffJSONDataset('{"frontrunner":4}')).toBe(null); // objects start with {, not [
    expect(sniffJSONDataset("[[1,2],[3,4]]")).toBe(null); // rows must be objects, not arrays
    expect(sniffJSONDataset("not json")).toBe(null);
    expect(sniffJSONDataset("[]")).toBe(null); // empty array isn't a usable dataset
  });

  test("jsonToTable: header order is first-record keys, then later-discovered keys appended", () => {
    const records = [
      { year: 1960, country: "China", population: 667070000 },
      { year: 1960, country: "India", population: 450547679, flag: "https://x/in.png" },
    ];
    const { headers, rows } = jsonToTable(records);
    expect(headers).toEqual(["year", "country", "population", "flag"]);
    expect(rows[0]).toEqual(["1960", "China", "667070000", ""]); // missing key -> ""
    expect(rows[1]).toEqual(["1960", "India", "450547679", "https://x/in.png"]);
  });

  test("end to end: a JSON array of records detects and normalizes exactly like the equivalent CSV", () => {
    const records = [
      { year: 1990, country: "Testland", pop: 10 },
      { year: 1990, country: "Otherland", pop: 5 },
      { year: 2000, country: "Testland", pop: 20 },
      { year: 2000, country: "Otherland", pop: 9 },
    ];
    const { headers, rows } = jsonToTable(records);
    const info = detectShape(headers, rows);
    expect(info.mapping).toEqual({ time: "year", entity: "country", value: "pop", image: null, category: null, color: null });
    const ds = normalize(headers, rows, info);
    expect(ds.periods).toEqual(["1990", "2000"]);
    expect(ds.entities).toEqual(["Testland", "Otherland"]);
  });
});

describe("degenerate datasets (regression)", () => {
  test("single-entity, 2-row long format never lets value collide with time", () => {
    const csv = "year,country,pop\n1990,Testland,10\n2000,Testland,20";
    const { headers, rows } = parseCSV(csv);
    const info = detectShape(headers, rows);
    expect(info.mapping.value).not.toBe(info.mapping.time);
    expect(info.mapping.value).toBe("pop");
  });
});

describe("image column", () => {
  test("long format: URL column auto-detected and mapped per entity", () => {
    const csv = "year,country,pop,flag\n1960,China,10,https://x/cn.png\n1970,China,20,https://x/cn.png\n1970,India,5,https://x/in.png";
    const { headers, rows } = parseCSV(csv);
    const info = detectShape(headers, rows);
    expect(info.mapping.image).toBe("flag");
    const ds = normalize(headers, rows, info);
    expect(ds.images).toEqual({ China: "https://x/cn.png", India: "https://x/in.png" });
  });
  test("wide format: URL column detected among non-temporal columns", () => {
    const csv = "country,logo,1960,1970\nChina,https://x/cn.png,10,20\nIndia,https://x/in.png,5,7";
    const { headers, rows } = parseCSV(csv);
    const info = detectShape(headers, rows);
    expect(info.shape).toBe("wide");
    expect(info.mapping.image).toBe("logo");
    const ds = normalize(headers, rows, info);
    expect(ds.images.India).toBe("https://x/in.png");
  });
  test("no URL column → image null, images empty", () => {
    const csv = "year,country,pop\n1960,China,10\n1970,China,20";
    const { headers, rows } = parseCSV(csv);
    const info = detectShape(headers, rows);
    expect(info.mapping.image).toBe(null);
    const ds = normalize(headers, rows, info);
    expect(ds.images).toEqual({});
  });
  test("last non-empty URL wins in long format", () => {
    const csv = "year,country,pop,flag\n1960,China,10,https://x/old.png\n1970,China,20,https://x/new.png";
    const { headers, rows } = parseCSV(csv);
    const ds = normalize(headers, rows, detectShape(headers, rows));
    expect(ds.images.China).toBe("https://x/new.png");
  });
});


describe("category column", () => {
  const CSV = "year,country,pop,continent\n1960,China,10,Asia\n1960,Brazil,5,Americas\n1970,China,20,Asia\n1970,Brazil,9,Americas\n1970,Nigeria,3,Africa";
  test("long format: low-cardinality string column auto-detected", () => {
    const { headers, rows } = parseCSV(CSV);
    const info = detectShape(headers, rows);
    expect(info.mapping.category).toBe("continent");
    const ds = normalize(headers, rows, info);
    expect(ds.categories).toEqual({ China: "Asia", Brazil: "Americas", Nigeria: "Africa" });
  });
  test("no candidate → category null, categories empty", () => {
    const csv = "year,country,pop\n1960,China,10\n1970,China,20";
    const { headers, rows } = parseCSV(csv);
    const info = detectShape(headers, rows);
    expect(info.mapping.category).toBe(null);
    expect(normalize(headers, rows, info).categories).toEqual({});
  });
  test("wide format: category detected among non-temporal columns", () => {
    const csv = "country,continent,1960,1970\nChina,Asia,10,20\nBrazil,Americas,5,9\nNigeria,Africa,1,3";
    const { headers, rows } = parseCSV(csv);
    const info = detectShape(headers, rows);
    expect(info.mapping.category).toBe("continent");
    expect(normalize(headers, rows, info).categories.Nigeria).toBe("Africa");
  });
  test("sample dataset carries continents", () => {
    const { headers, rows } = parseCSV(require("../src/builtins.js").sampleCSV());
    const info = detectShape(headers, rows);
    expect(info.mapping.category).toBe("continent");
    const ds = normalize(headers, rows, info);
    expect(ds.categories.China).toBe("Asia");
    expect(ds.categories.Nigeria).toBe("Africa");
  });
});


describe("color column", () => {
  const CSV = "year,country,pop,brand_hex\n1960,China,10,#e8836f\n1970,China,20,#e8836f\n1970,India,5,#4fb8ad";
  test("long format: hex-color column auto-detected and mapped per entity", () => {
    const { headers, rows } = parseCSV(CSV);
    const info = detectShape(headers, rows);
    expect(info.mapping.color).toBe("brand_hex");
    const ds = normalize(headers, rows, info);
    expect(ds.colors).toEqual({ China: "#e8836f", India: "#4fb8ad" });
  });
  test("no candidate → color null, colors empty", () => {
    const csv = "year,country,pop\n1960,China,10\n1970,China,20";
    const { headers, rows } = parseCSV(csv);
    const info = detectShape(headers, rows);
    expect(info.mapping.color).toBe(null);
    expect(normalize(headers, rows, info).colors).toEqual({});
  });
  test("wide format: color column detected among non-temporal columns", () => {
    const csv = "country,brand_hex,1960,1970\nChina,#e8836f,10,20\nIndia,#4fb8ad,5,9";
    const { headers, rows } = parseCSV(csv);
    const info = detectShape(headers, rows);
    expect(info.mapping.color).toBe("brand_hex");
    expect(normalize(headers, rows, info).colors.India).toBe("#4fb8ad");
  });
  test("color and category columns coexist without colliding", () => {
    const csv = "year,country,pop,brand_hex,continent\n1960,China,10,#e8836f,Asia\n1970,India,5,#4fb8ad,Asia\n1970,Nigeria,3,#c9b458,Africa";
    const { headers, rows } = parseCSV(csv);
    const info = detectShape(headers, rows);
    expect(info.mapping.color).toBe("brand_hex");
    expect(info.mapping.category).toBe("continent");
  });
});
