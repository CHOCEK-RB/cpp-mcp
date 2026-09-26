import { LRUCache } from "lru-cache";

export interface SearchResultPayload {
  query: string;
  result_urls: string[];
}

export interface PageResultPayload {
  content: string;
  next_cursor: string | null;
}

export const searchCache = new LRUCache<string, SearchResultPayload>({
  max: 200,
});

export const pageCache = new LRUCache<string, string>({
  max: 50,
});
