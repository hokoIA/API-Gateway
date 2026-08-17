  BEGIN;
  
  INSERT INTO permissions (code, description, group_name)
  VALUES (
    'platforms:connect',
    'Conectar/Desconectar integrações',
    'platforms'
  )
  ON CONFLICT (lower(code)) DO NOTHING;
  
  INSERT INTO role_permissions (id_role, id_permission)
  SELECT r.id_role, p.id_permission
  FROM roles r
  JOIN permissions p ON lower(p.code) = 'platforms:connect'
  WHERE lower(r.name) = 'equipe'
  ON CONFLICT DO NOTHING;
  
  COMMIT;
