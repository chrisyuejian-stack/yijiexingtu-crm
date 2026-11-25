CREATE TRIGGER style_asset_immutable BEFORE UPDATE ON style_assets BEGIN SELECT RAISE(ABORT,'style_asset_immutable'); END;
