UPDATE `user` SET `role` = CASE WHEN instr(',' || coalesce(`role`, '') || ',', ',admin,') > 0 THEN 'admin' ELSE 'user' END;
