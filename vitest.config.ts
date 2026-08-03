import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      'packages/*',
      'apps/*',
      // Die Architekturregeln gehören keinem Paket: Sie prüfen die Grenzen
      // zwischen ihnen und lesen dafür Quelltexte aus dem ganzen Repo.
      { test: { name: 'architektur', include: ['tests/architektur/*.test.ts'] } },
    ],
  },
});
