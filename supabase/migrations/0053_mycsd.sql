-- 0053 — MyCSD on a post.
--
-- MyCSD is USM's co-curricular record: students earn points for taking part
-- in events. A club can say whether its event counts for MyCSD (yes or no),
-- so students see it on the card and the event page. It is the club's own
-- claim; usmfomo does not award or check MyCSD points.

alter table public.posts
  add column mycsd boolean not null default false;

grant insert (mycsd), update (mycsd) on public.posts to authenticated;

-- The dashboard lists show it too. The return type changes, so drop and recreate.
drop function public.search_posts(public.org_type, text, public.campus, uuid, int, int);

create function public.search_posts(
  p_type public.org_type,
  p_q text default null,
  p_campus public.campus default null,
  p_org uuid default null,
  p_limit int default 20,
  p_offset int default 0
)
returns table (
  id uuid,
  org_id uuid,
  org_name text,
  org_slug text,
  org_type public.org_type,
  campus public.campus,
  title text,
  venue text,
  starts_at timestamptz,
  ends_at timestamptz,
  thumb_path text,
  cancelled_at timestamptz,
  details_changed_at timestamptz,
  mycsd boolean,
  total bigint
)
language sql stable security invoker set search_path = ''
as $$
  with q as (
    select nullif(btrim(left(coalesce(p_q, ''), 100)), '') as text
  ), pattern as (
    select '%' || replace(replace(replace(q.text, '\', '\\'), '%', '\%'), '_', '\_') || '%' as like
    from q where q.text is not null
  )
  select p.id, p.org_id, o.name, o.slug, o.type, p.campus, p.title, p.venue,
         p.starts_at, p.ends_at, p.thumb_path, p.cancelled_at, p.details_changed_at,
         p.mycsd,
         count(*) over () as total
  from public.posts p
  join public.orgs o on o.id = p.org_id
  where o.type = p_type
    and o.active
    and p.ends_at > now()
    and p.hidden_at is null
    and (select s.public_reads_enabled from public.site_settings s where s.id = 1)
    and (p_campus is null or p.campus = p_campus)
    and (p_org is null or p.org_id = p_org)
    and (
      not exists (select 1 from pattern)
      or p.title ilike (select pattern.like from pattern)
      or p.venue ilike (select pattern.like from pattern)
      or o.name ilike (select pattern.like from pattern)
    )
  order by (p.starts_at <= now()) desc,
           case when p.starts_at <= now() then p.ends_at end asc,
           p.starts_at asc,
           p.id
  limit least(greatest(coalesce(p_limit, 20), 1), 50)
  offset greatest(coalesce(p_offset, 0), 0);
$$;
revoke all on function public.search_posts(public.org_type, text, public.campus, uuid, int, int) from public;
grant execute on function public.search_posts(public.org_type, text, public.campus, uuid, int, int) to anon, authenticated;
