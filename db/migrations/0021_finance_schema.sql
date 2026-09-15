-- Fase 7 (Finance Ready): schema completo do módulo financeiro (ADR 009/016/022,
-- DATA_MODEL_REVIEW.md §2.6). Schema-only — o Finance Agent em si NÃO é implementado nesta
-- fase (D009/ADR 022): nenhuma rota, nenhuma UI, nenhuma integração de open banking. Toda
-- tabela nasce já seguindo as convenções do resto do sistema (D016 dinheiro em centavos, D014
-- RLS obrigatória), nunca um padrão próprio.

-- D016: dinheiro é SEMPRE bigint em centavos + currency — nunca float/numeric solto sem
-- unidade. Um valor decimal (ex.: 19.99) enviado a uma coluna bigint é rejeitado pelo próprio
-- Postgres na ligação do parâmetro (erro de sintaxe/tipo), não por uma checagem de aplicação —
-- essa é a "Regra de Ouro Monetária" sendo imposta no nível de schema, não de convenção.

CREATE TABLE financial_accounts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id   uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  person_id      uuid REFERENCES profiles(id) ON DELETE SET NULL, -- nullable: contas podem ser do casal, não de uma pessoa só
  name           text NOT NULL,
  type           text NOT NULL CHECK (type IN ('checking', 'savings', 'investment', 'cash')),
  balance_cents  bigint NOT NULL DEFAULT 0,
  currency       char(3) NOT NULL DEFAULT 'BRL',
  active         boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX financial_accounts_household_id_idx ON financial_accounts (household_id);
CREATE TRIGGER financial_accounts_set_updated_at BEFORE UPDATE ON financial_accounts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE financial_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_accounts FORCE ROW LEVEL SECURITY;
CREATE POLICY financial_accounts_household_scope ON financial_accounts
  USING (household_id = app_household_id())
  WITH CHECK (household_id = app_household_id());

CREATE TABLE financial_credit_cards (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id   uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  person_id      uuid REFERENCES profiles(id) ON DELETE SET NULL,
  name           text NOT NULL,
  limit_cents    bigint NOT NULL CHECK (limit_cents > 0),
  closing_day    smallint NOT NULL CHECK (closing_day BETWEEN 1 AND 31),
  due_day        smallint NOT NULL CHECK (due_day BETWEEN 1 AND 31),
  currency       char(3) NOT NULL DEFAULT 'BRL',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX financial_credit_cards_household_id_idx ON financial_credit_cards (household_id);
CREATE TRIGGER financial_credit_cards_set_updated_at BEFORE UPDATE ON financial_credit_cards
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE financial_credit_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_credit_cards FORCE ROW LEVEL SECURITY;
CREATE POLICY financial_credit_cards_household_scope ON financial_credit_cards
  USING (household_id = app_household_id())
  WITH CHECK (household_id = app_household_id());

-- household_id nullable: a categoria pode ser um padrão GLOBAL do sistema (household_id NULL,
-- semeada por migration/admin, nunca por um household) ou uma categoria própria do household.
-- A RLS abaixo reflete essa mistura: leitura vê as duas, escrita só pode criar para o próprio
-- household (nunca uma linha global).
CREATE TABLE financial_categories (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id   uuid REFERENCES households(id) ON DELETE CASCADE,
  name           text NOT NULL,
  type           text NOT NULL CHECK (type IN ('income', 'expense')),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX financial_categories_household_id_idx ON financial_categories (household_id);

ALTER TABLE financial_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_categories FORCE ROW LEVEL SECURITY;
CREATE POLICY financial_categories_scope ON financial_categories
  USING (household_id = app_household_id() OR household_id IS NULL)
  WITH CHECK (household_id = app_household_id());

-- Append-only (mesma convenção de measurements/workout_logs/market_prices): uma correção é uma
-- nova transação (ex.: estorno), nunca um UPDATE apagando o que aconteceu (enforced também no
-- nível de GRANT em 0022_finance_grants.sql).
CREATE TABLE financial_transactions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id    uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  account_id      uuid REFERENCES financial_accounts(id) ON DELETE SET NULL,
  credit_card_id  uuid REFERENCES financial_credit_cards(id) ON DELETE SET NULL,
  category_id     uuid REFERENCES financial_categories(id) ON DELETE SET NULL,
  person_id       uuid REFERENCES profiles(id) ON DELETE SET NULL,
  amount_cents    bigint NOT NULL CHECK (amount_cents <> 0),
  currency        char(3) NOT NULL DEFAULT 'BRL',
  type            text NOT NULL CHECK (type IN ('income', 'expense', 'transfer')),
  transacted_at   timestamptz NOT NULL,
  description     text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT financial_transactions_needs_a_source CHECK (account_id IS NOT NULL OR credit_card_id IS NOT NULL)
);
CREATE INDEX financial_transactions_household_id_idx ON financial_transactions (household_id, transacted_at DESC);
CREATE INDEX financial_transactions_account_id_idx ON financial_transactions (account_id);
CREATE INDEX financial_transactions_credit_card_id_idx ON financial_transactions (credit_card_id);

ALTER TABLE financial_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_transactions FORCE ROW LEVEL SECURITY;
CREATE POLICY financial_transactions_household_scope ON financial_transactions
  USING (household_id = app_household_id())
  WITH CHECK (household_id = app_household_id());

CREATE TABLE financial_debts (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id           uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  person_id              uuid REFERENCES profiles(id) ON DELETE SET NULL,
  name                   text NOT NULL,
  total_cents            bigint NOT NULL CHECK (total_cents >= 0),
  remaining_cents        bigint NOT NULL CHECK (remaining_cents >= 0),
  interest_rate_monthly  numeric(6,4),
  due_date               date,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT financial_debts_remaining_within_total CHECK (remaining_cents <= total_cents)
);
CREATE INDEX financial_debts_household_id_idx ON financial_debts (household_id);
CREATE TRIGGER financial_debts_set_updated_at BEFORE UPDATE ON financial_debts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE financial_debts ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_debts FORCE ROW LEVEL SECURITY;
CREATE POLICY financial_debts_household_scope ON financial_debts
  USING (household_id = app_household_id())
  WITH CHECK (household_id = app_household_id());

-- version: concorrência otimista (D017) — mesma convenção de goals/meal_plans/workout_plans.
CREATE TABLE financial_budgets (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id   uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  category_id    uuid NOT NULL REFERENCES financial_categories(id),
  month          smallint NOT NULL CHECK (month BETWEEN 1 AND 12),
  year           smallint NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  target_cents   bigint NOT NULL CHECK (target_cents > 0),
  version        integer NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX financial_budgets_household_category_period_unique
  ON financial_budgets (household_id, category_id, month, year);
CREATE TRIGGER financial_budgets_set_updated_at BEFORE UPDATE ON financial_budgets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE financial_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_budgets FORCE ROW LEVEL SECURITY;
CREATE POLICY financial_budgets_household_scope ON financial_budgets
  USING (household_id = app_household_id())
  WITH CHECK (household_id = app_household_id());

-- Nome `financial_goals` (não `goals`) para não colidir com a tabela de metas gerais já
-- existente desde a Fase 1 (DATA_MODEL_REVIEW.md §2.6).
CREATE TABLE financial_goals (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id   uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  person_id      uuid REFERENCES profiles(id) ON DELETE SET NULL,
  title          text NOT NULL,
  target_cents   bigint NOT NULL CHECK (target_cents > 0),
  current_cents  bigint NOT NULL DEFAULT 0 CHECK (current_cents >= 0),
  deadline       date,
  version        integer NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX financial_goals_household_id_idx ON financial_goals (household_id);
CREATE TRIGGER financial_goals_set_updated_at BEFORE UPDATE ON financial_goals
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE financial_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_goals FORCE ROW LEVEL SECURITY;
CREATE POLICY financial_goals_household_scope ON financial_goals
  USING (household_id = app_household_id())
  WITH CHECK (household_id = app_household_id());

-- Defense in depth (mesmo espírito do enforce_decision_transition/enforce_workout_session_*):
-- o flag households.module_finance_enabled é checado pela aplicação (financeGuard.ts) E aqui,
-- como segunda camada independente — mesmo um bug na camada de aplicação não permite gravar
-- dado financeiro para um household que nunca habilitou o módulo. Linhas globais
-- (financial_categories.household_id IS NULL) não são checadas: não pertencem a household nenhum.
CREATE OR REPLACE FUNCTION enforce_finance_module_enabled()
RETURNS trigger AS $$
DECLARE
  enabled boolean;
BEGIN
  IF NEW.household_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT module_finance_enabled INTO enabled FROM households WHERE id = NEW.household_id;
  IF NOT COALESCE(enabled, false) THEN
    RAISE EXCEPTION 'finance module is not enabled for household %', NEW.household_id
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER financial_accounts_enforce_module_flag BEFORE INSERT OR UPDATE ON financial_accounts
  FOR EACH ROW EXECUTE FUNCTION enforce_finance_module_enabled();
CREATE TRIGGER financial_credit_cards_enforce_module_flag BEFORE INSERT OR UPDATE ON financial_credit_cards
  FOR EACH ROW EXECUTE FUNCTION enforce_finance_module_enabled();
CREATE TRIGGER financial_categories_enforce_module_flag BEFORE INSERT OR UPDATE ON financial_categories
  FOR EACH ROW EXECUTE FUNCTION enforce_finance_module_enabled();
CREATE TRIGGER financial_transactions_enforce_module_flag BEFORE INSERT OR UPDATE ON financial_transactions
  FOR EACH ROW EXECUTE FUNCTION enforce_finance_module_enabled();
CREATE TRIGGER financial_debts_enforce_module_flag BEFORE INSERT OR UPDATE ON financial_debts
  FOR EACH ROW EXECUTE FUNCTION enforce_finance_module_enabled();
CREATE TRIGGER financial_budgets_enforce_module_flag BEFORE INSERT OR UPDATE ON financial_budgets
  FOR EACH ROW EXECUTE FUNCTION enforce_finance_module_enabled();
CREATE TRIGGER financial_goals_enforce_module_flag BEFORE INSERT OR UPDATE ON financial_goals
  FOR EACH ROW EXECUTE FUNCTION enforce_finance_module_enabled();
