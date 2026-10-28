-- Apply this migration in the Supabase SQL editor before deploying the matching app.
-- Existing public profiles need to sync once afterward to publish the versioned snapshot.

ALTER TABLE public.cartovella_passports
  ADD COLUMN IF NOT EXISTS public_trip_sharing_version integer;

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
  passport_data || jsonb_build_object(
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
  ) AS public_passport_data
FROM public.cartovella_passports
WHERE is_public IS TRUE
  AND username IS NOT NULL
  AND public_trip_sharing_version = 1;

REVOKE ALL ON TABLE public.cartovella_public_profiles FROM PUBLIC;
GRANT SELECT ON TABLE public.cartovella_public_profiles TO anon, authenticated;
