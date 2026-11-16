-- Ativação 0B: estrutura aditiva.
-- Aplicação registrada em 2026-11-16 no banco interno configurado no .env
-- de Hoko-Backend: CREATE TABLE; INSERT 0 1; INSERT 0 5; COMMIT.
-- Outros ambientes devem registrar sua própria aplicação antes de usar o schema.
-- Pré-condições: customer(id_customer), permissions(code), roles e role_permissions
-- devem corresponder ao catálogo verificado antes da execução.
-- Clientes legados e o default 'active' de customer.status permanecem intactos.
BEGIN;

CREATE TABLE IF NOT EXISTS public.customer_activation (
  id_activation uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_customer integer NOT NULL UNIQUE REFERENCES public.customer(id_customer) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.permissions (code, description, group_name)
VALUES ('activation:manage', 'Gerenciar ativação de clientes', 'customers')
ON CONFLICT (lower(code)) DO NOTHING;

INSERT INTO public.role_permissions (id_role, id_permission)
SELECT r.id_role, p.id_permission
FROM public.roles r
JOIN public.permissions p ON p.code = 'activation:manage'
WHERE lower(r.name) = 'admin'
ON CONFLICT DO NOTHING;

COMMIT;

-- Validação após aplicação: customer_activation existe, permissão foi criada,
-- Admins a receberam e nenhum registro legado mudou de status.
-- Reversão antes de dados novos: remover grants/permissão e a tabela em transação.
-- Depois de criar ativações, restaurar backup ou migrar vínculos antes de reverter.
