DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "UserPosition"
    WHERE "projectId" IS NULL
    GROUP BY "userId", "positionId"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'duplicate global UserPosition rows must be resolved before migration';
  END IF;
END $$;

CREATE UNIQUE INDEX "UserPosition_global_user_position_key"
  ON "UserPosition"("userId", "positionId")
  WHERE "projectId" IS NULL;
