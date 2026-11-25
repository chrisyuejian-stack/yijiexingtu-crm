-- v0.3.9: additive metadata only. Existing content and revisions remain intact.
ALTER TABLE content_items ADD COLUMN article_json TEXT NOT NULL DEFAULT 'null' CHECK(json_valid(article_json));
