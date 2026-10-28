-- Apply this migration in the Supabase SQL editor before deploying the matching app.
-- Legacy public profiles become Entire Passport; private profiles become None. Existing
-- public profiles need to sync once afterward to publish their versioned summary snapshot.

ALTER TABLE public.cartovella_passports
  ADD COLUMN IF NOT EXISTS public_trip_sharing_version integer;

ALTER TABLE public.cartovella_passports
  ADD COLUMN IF NOT EXISTS profile_visibility text;

UPDATE public.cartovella_passports
SET profile_visibility = CASE WHEN is_public IS TRUE THEN 'passport' ELSE 'none' END
WHERE profile_visibility IS NULL;

ALTER TABLE public.cartovella_passports
  ALTER COLUMN profile_visibility SET DEFAULT 'none',
  ALTER COLUMN profile_visibility SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.cartovella_passports'::regclass
      AND conname = 'cartovella_passports_profile_visibility_check'
  ) THEN
    ALTER TABLE public.cartovella_passports
      ADD CONSTRAINT cartovella_passports_profile_visibility_check
      CHECK (profile_visibility IN ('none', 'profile', 'passport'));
  END IF;
END;
$$;

ALTER TABLE public.cartovella_passports
  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view public passports"
  ON public.cartovella_passports;

REVOKE SELECT ON TABLE public.cartovella_passports FROM anon;

CREATE OR REPLACE VIEW public.cartovella_public_profiles
WITH (security_barrier = true)
AS
SELECT
  username,
  display_name,
  updated_at,
  summary_stats,
  CASE WHEN profile_visibility = 'passport' THEN passport_data || jsonb_build_object(
    'expeditions',
    COALESCE((
      SELECT jsonb_agg(
        (
          (expedition.trip - 'publicSharing' - 'photos' - 'journal')
          || CASE WHEN expedition.trip->'publicSharing'->>'includeJournal' = 'true'
            THEN jsonb_build_object('journal', COALESCE(expedition.trip->>'journal', ''))
            ELSE '{}'::jsonb
          END
          || jsonb_build_object(
            'photos',
            COALESCE((
              SELECT jsonb_agg(photo.value ORDER BY photo.ordinal)
              FROM jsonb_array_elements(
                CASE WHEN jsonb_typeof(expedition.trip->'photos') = 'array'
                  THEN expedition.trip->'photos' ELSE '[]'::jsonb
                END
              ) WITH ORDINALITY AS photo(value, ordinal)
              WHERE jsonb_typeof(expedition.trip->'publicSharing'->'photoIndexes') = 'array'
                AND expedition.trip->'publicSharing'->'photoIndexes'
                  @> jsonb_build_array(photo.ordinal - 1)
            ), '[]'::jsonb)
          )
        )
        ORDER BY expedition.ordinal
      )
      FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(passport_data->'expeditions') = 'array'
          THEN passport_data->'expeditions' ELSE '[]'::jsonb
        END
      ) WITH ORDINALITY AS expedition(trip, ordinal)
      WHERE expedition.trip->'publicSharing'->>'enabled' = 'true'
        AND expedition.trip->'publicSharing'->>'includeDetails' = 'true'
    ), '[]'::jsonb)
  ) ELSE NULL::jsonb END AS public_passport_data,
  profile_visibility
FROM public.cartovella_passports
WHERE profile_visibility IN ('profile', 'passport')
  AND username IS NOT NULL
  AND public_trip_sharing_version = 1;

REVOKE ALL ON TABLE public.cartovella_public_profiles FROM PUBLIC;
GRANT SELECT ON TABLE public.cartovella_public_profiles TO anon, authenticated;
