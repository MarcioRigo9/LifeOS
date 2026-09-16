-- Ingestão de preços reais (Fase Scraping): market_prices tinha `brand` mas nenhum lugar para
-- o TÍTULO do produto sanitizado (ex.: "Peito de Frango Sadia 1kg Bandeja") — sem essa coluna, a
-- sanitização de dado não confiável (SECURITY_MODEL.md §7) não tinha onde persistir seu
-- resultado. Nullable: toda linha já existente (e o caminho de INSERT manual/teste que não passa
-- por um provider) continua válida sem preenchê-la.

ALTER TABLE market_prices ADD COLUMN product_title text;
