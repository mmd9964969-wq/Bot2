UPDATE agent_settings
SET autopilot_enabled=TRUE,
    auto_deploy=TRUE,
    enabled=TRUE,
    updated_at=NOW()
WHERE id=TRUE;
