BEGIN;

-- =========================================================
-- 0) PRE-CHECKS / EXTENSIONS (opcional)
-- =========================================================

-- (Opcional) Se você quiser usar gen_random_uuid futuramente:
-- CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =========================================================
-- 1) ACCOUNTS
-- =========================================================

CREATE TABLE IF NOT EXISTS accounts (
  id_account BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active', -- active | disabled
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_accounts_status ON accounts(status);

-- =========================================================
-- 2) ADD account_id TO "user"
-- =========================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'user'
      AND column_name = 'id_account'
  ) THEN
    ALTER TABLE "user" ADD COLUMN id_account BIGINT NULL;
  END IF;
END$$;

-- FK (cria só se ainda não existir)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_user_account'
  ) THEN
    ALTER TABLE "user"
      ADD CONSTRAINT fk_user_account
      FOREIGN KEY (id_account) REFERENCES accounts(id_account)
      ON DELETE RESTRICT;
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_user_id_account ON "user"(id_account);

-- =========================================================
-- 3) RBAC TABLES
-- =========================================================

-- 3.1) Permissions (catálogo global)
CREATE TABLE IF NOT EXISTS permissions (
  id_permission BIGSERIAL PRIMARY KEY,
  code TEXT NOT NULL,
  description TEXT NOT NULL,
  group_name TEXT NOT NULL
);

-- unique case-insensitive
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'ux_permissions_code_lower'
  ) THEN
    CREATE UNIQUE INDEX ux_permissions_code_lower ON permissions (lower(code));
  END IF;
END$$;

-- 3.2) Roles (por account)
CREATE TABLE IF NOT EXISTS roles (
  id_role BIGSERIAL PRIMARY KEY,
  id_account BIGINT NOT NULL,
  name TEXT NOT NULL,               -- Admin | Equipe (por enquanto)
  is_system BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fk_roles_account FOREIGN KEY (id_account)
    REFERENCES accounts(id_account) ON DELETE CASCADE
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'ux_roles_account_name_lower'
  ) THEN
    CREATE UNIQUE INDEX ux_roles_account_name_lower ON roles (id_account, lower(name));
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_roles_account ON roles(id_account);

-- 3.3) Role permissions (role -> permission)
CREATE TABLE IF NOT EXISTS role_permissions (
  id_role BIGINT NOT NULL,
  id_permission BIGINT NOT NULL,
  PRIMARY KEY (id_role, id_permission),
  CONSTRAINT fk_rp_role FOREIGN KEY (id_role) REFERENCES roles(id_role) ON DELETE CASCADE,
  CONSTRAINT fk_rp_permission FOREIGN KEY (id_permission) REFERENCES permissions(id_permission) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_rp_role ON role_permissions(id_role);
CREATE INDEX IF NOT EXISTS idx_rp_permission ON role_permissions(id_permission);

-- 3.4) Team members (user <-> account)
CREATE TABLE IF NOT EXISTS team_members (
  id_team_member BIGSERIAL PRIMARY KEY,
  id_account BIGINT NOT NULL,
  id_user BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active', -- active | pending | disabled
  invited_at TIMESTAMPTZ NULL,
  joined_at TIMESTAMPTZ NULL,
  disabled_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fk_tm_account FOREIGN KEY (id_account) REFERENCES accounts(id_account) ON DELETE CASCADE,
  CONSTRAINT fk_tm_user FOREIGN KEY (id_user) REFERENCES "user"(id_user) ON DELETE CASCADE
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'ux_tm_account_user'
  ) THEN
    CREATE UNIQUE INDEX ux_tm_account_user ON team_members (id_account, id_user);
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_tm_account ON team_members(id_account);
CREATE INDEX IF NOT EXISTS idx_tm_user ON team_members(id_user);

-- 3.5) Member roles (team_member -> role)
-- Regra atual: 1 role por member (UNIQUE id_team_member)
CREATE TABLE IF NOT EXISTS member_roles (
  id_team_member BIGINT NOT NULL,
  id_role BIGINT NOT NULL,
  PRIMARY KEY (id_team_member, id_role),
  CONSTRAINT fk_mr_team_member FOREIGN KEY (id_team_member) REFERENCES team_members(id_team_member) ON DELETE CASCADE,
  CONSTRAINT fk_mr_role FOREIGN KEY (id_role) REFERENCES roles(id_role) ON DELETE CASCADE
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'ux_member_roles_one_role_per_member'
  ) THEN
    CREATE UNIQUE INDEX ux_member_roles_one_role_per_member ON member_roles (id_team_member);
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_mr_role ON member_roles(id_role);

-- 3.6) Invites
CREATE TABLE IF NOT EXISTS invites (
  id_invite BIGSERIAL PRIMARY KEY,
  id_account BIGINT NOT NULL,
  email TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ NULL,
  created_by_user_id BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fk_inv_account FOREIGN KEY (id_account) REFERENCES accounts(id_account) ON DELETE CASCADE,
  CONSTRAINT fk_inv_created_by FOREIGN KEY (created_by_user_id) REFERENCES "user"(id_user) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_inv_account ON invites(id_account);
CREATE INDEX IF NOT EXISTS idx_inv_email_lower ON invites(lower(email));

-- =========================================================
-- 4) SEED: PERMISSIONS
-- =========================================================

INSERT INTO permissions (code, description, group_name)
VALUES
  -- Pages
  ('page:dashboard:view',   'Acessar página Dashboard',        'page'),
  ('page:analyses:view',    'Acessar página Análises',         'page'),
  ('page:food_model:view',  'Acessar página Alimentar Modelo', 'page'),
  ('page:goals:view',       'Acessar página Metas',            'page'),
  ('page:customers:view',   'Acessar página Clientes',         'page'),
  ('page:team:view',        'Acessar página Equipe',           'page'),
  ('page:kanban:view',      'Acessar página Kanban',           'page'),
  ('page:settings:view',    'Acessar página Configurações',    'page'),

  -- Actions
  ('customers:manage',      'Criar/Editar/Remover clientes',   'customers'),
  ('analyses:run',          'Gerar análises',                  'analyses'),
  ('platforms:connect',     'Conectar/Desconectar integrações','platforms'),
  ('food_model:run',        'Rodar/Alimentar modelo',          'food_model'),
  ('team:manage',           'Gerenciar equipe (convites/roles)','team')
ON CONFLICT (lower(code)) DO NOTHING;

-- =========================================================
-- 5) MIGRATE EXISTING USERS -> ACCOUNTS + ADMIN ROLE
-- =========================================================
-- Estratégia:
-- - Para cada user sem id_account:
--   - cria 1 account
--   - seta user.id_account
-- - Para cada account:
--   - cria roles Admin e Equipe (system)
--   - cria role_permissions conforme matriz
-- - Para cada user (dono):
--   - cria team_member active
--   - atribui role Admin

-- 5.1) criar accounts para usuários sem account
DO $$
DECLARE
  u RECORD;
  new_account_id BIGINT;
BEGIN
  FOR u IN
    SELECT id_user, name
    FROM "user"
    WHERE id_account IS NULL
  LOOP
    INSERT INTO accounts (name, status)
    VALUES (COALESCE(u.name, 'Conta #' || u.id_user::text), 'active')
    RETURNING id_account INTO new_account_id;

    UPDATE "user" SET id_account = new_account_id WHERE id_user = u.id_user;
  END LOOP;
END$$;

-- 5.2) agora que todo mundo tem id_account, tornar NOT NULL
DO $$
BEGIN
  -- só seta NOT NULL se não existir null
  IF NOT EXISTS (SELECT 1 FROM "user" WHERE id_account IS NULL) THEN
    ALTER TABLE "user" ALTER COLUMN id_account SET NOT NULL;
  END IF;
END$$;

-- 5.3) criar roles Admin/Equipe por account (se não existirem)
INSERT INTO roles (id_account, name, is_system)
SELECT a.id_account, 'Admin', true
FROM accounts a
WHERE NOT EXISTS (
  SELECT 1 FROM roles r
  WHERE r.id_account = a.id_account AND lower(r.name) = 'admin'
);

INSERT INTO roles (id_account, name, is_system)
SELECT a.id_account, 'Equipe', true
FROM accounts a
WHERE NOT EXISTS (
  SELECT 1 FROM roles r
  WHERE r.id_account = a.id_account AND lower(r.name) = 'equipe'
);

-- 5.4) role_permissions: Admin = tudo
INSERT INTO role_permissions (id_role, id_permission)
SELECT r.id_role, p.id_permission
FROM roles r
JOIN permissions p ON true
WHERE lower(r.name) = 'admin'
ON CONFLICT DO NOTHING;

-- 5.5) role_permissions: Equipe = matriz confirmada
-- Equipe: pages dashboard/analyses/customers/chat + actions customers:manage/analyses:run/platforms:connect
INSERT INTO role_permissions (id_role, id_permission)
SELECT r.id_role, p.id_permission
FROM roles r
JOIN permissions p
  ON lower(p.code) IN (
    'page:dashboard:view',
    'page:analyses:view',
    'page:customers:view',
    'page:chat:view',
    'customers:manage',
    'analyses:run',
    'platforms:connect'
  )
WHERE lower(r.name) = 'equipe'
ON CONFLICT DO NOTHING;

-- 5.6) criar team_member active para cada user (como membro da própria account)
INSERT INTO team_members (id_account, id_user, status, joined_at)
SELECT u.id_account, u.id_user, 'active', now()
FROM "user" u
WHERE NOT EXISTS (
  SELECT 1 FROM team_members tm
  WHERE tm.id_account = u.id_account AND tm.id_user = u.id_user
);

-- 5.7) atribuir role Admin para o team_member do dono (user)
INSERT INTO member_roles (id_team_member, id_role)
SELECT tm.id_team_member, r.id_role
FROM team_members tm
JOIN "user" u ON u.id_user = tm.id_user AND u.id_account = tm.id_account
JOIN roles r ON r.id_account = tm.id_account AND lower(r.name) = 'admin'
WHERE NOT EXISTS (
  SELECT 1 FROM member_roles mr
  WHERE mr.id_team_member = tm.id_team_member
);

COMMIT;
