-- Rise Path migration 010: index material_chunks.embedding_model
-- Before each search, RAG checks whether the searched scope holds chunks embedded with the current
-- model and chunks from an older model or none (tools/core/ragSearch.js embeddingCoverage). Older
-- chunks are matched by keyword and merged with the vector results. This index keeps both EXISTS
-- probes (and the older-chunk keyword scan) from reading the whole table once it is large.

CREATE INDEX IF NOT EXISTS material_chunks_embedding_model_idx
  ON material_chunks (embedding_model);
