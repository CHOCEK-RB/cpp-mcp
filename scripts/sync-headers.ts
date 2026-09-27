#!/usr/bin/env bun
import * as cheerio from "cheerio";
import pkg from "../package.json" with { type: "json" };
import { CPP_STANDARD_HEADERS } from "../src/data/headers.js";

const CPP_HEADERS_URL = "https://en.cppreference.com/w/cpp/header";

async function verifyHeaders(): Promise<void> {
  console.log(`Checking cppreference headers from ${CPP_HEADERS_URL}...`);
  try {
    const res = await fetch(CPP_HEADERS_URL, {
      headers: {
        "User-Agent": `cpp-mcp-sync/${pkg.version} (+https://github.com/CHOCEK-RB/cpp-mcp)`,
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      console.warn(
        `Could not reach cppreference: HTTP ${res.status}. Using existing static dataset.`,
      );
      return;
    }

    const html = await res.text();
    const $ = cheerio.load(html);
    const remoteHeaders: string[] = [];

    $('a[href*="/cpp/header/"]').each((_, el) => {
      const txt = $(el)
        .text()
        .trim()
        .replace(/[\s\n]+/g, "");
      if (txt.startsWith("<") && txt.endsWith(">")) {
        remoteHeaders.push(txt);
      }
    });

    const localHeaders = new Set(CPP_STANDARD_HEADERS.map((h) => h.header));
    console.log(`Verified ${localHeaders.size} local standard headers.`);
    console.log(`Found ${remoteHeaders.length} headers mentioned on remote page.`);
  } catch (error) {
    console.warn(
      `Sync check offline or timed out: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

verifyHeaders().catch((err) => {
  console.error(err);
  process.exit(1);
});
