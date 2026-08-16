UPDATE crm_plan_versions
SET
  code = 'ENTERPRISE',
  display_name = 'Enterprise',
  definition = jsonb_set(definition, '{displayName}', '"Enterprise"'::jsonb)
WHERE code = 'INTELIGENTE' OR code = 'ENTERPRISE';
