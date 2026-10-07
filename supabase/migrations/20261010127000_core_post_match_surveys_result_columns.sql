-- Core: the post-match survey keeps the winner each player reports.
--
-- The survey writes post_match_surveys.ganador / resultado and the results and awards
-- read them (surveyCompletionService), but the canonical schema never had the columns
-- (Production does: the app reads them there). On every database built from the repo the
-- insert failed, the client retried without them, and the "¿Quién ganó?" answer was
-- silently dropped — one extra round trip per submission and no winner in the results.
-- ADD COLUMN IF NOT EXISTS: a no-op where the columns already exist.

alter table public.post_match_surveys add column if not exists ganador text;
alter table public.post_match_surveys add column if not exists resultado text;

do $post_match_surveys_result_columns_check$
begin
  if (
    select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'post_match_surveys'
      and column_name in ('ganador', 'resultado')
  ) <> 2 then
    raise exception 'post_match_surveys result columns did not install';
  end if;
  if not has_column_privilege('authenticated', 'public.post_match_surveys', 'ganador', 'insert') then
    raise exception 'authenticated must be able to write the reported winner';
  end if;
end
$post_match_surveys_result_columns_check$;
