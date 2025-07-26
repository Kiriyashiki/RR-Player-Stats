import datetime


def prettydate(d: datetime.datetime) -> str:
    diff = datetime.datetime.now(datetime.UTC) - d
    s = diff.seconds
    if diff.days > 14 or diff.days < 0:
        return d.strftime('%d %B %Y')
    elif diff.days == 1:
        return '1 day ago'
    elif diff.days > 1:
        return '{} days ago'.format(diff.days)
    elif s <= 1:
        return 'just now'
    elif s < 60:
        return '{} seconds ago'.format(s)
    elif s < 120:
        return '1 minute ago'
    elif s < 3600:
        return '{} minutes ago'.format(s // 60)
    elif s < 7200:
        return '1 hour ago'
    else:
        return '{} hours ago'.format(s // 3600)


def minutes_to_hours_minutes(total_minutes):
    hours = total_minutes // 60
    minutes = total_minutes % 60
    parts = []
    if hours > 0:
        parts.append(f"{hours} hour{'s' if hours != 1 else ''}")
    if minutes > 0 or not parts:
        parts.append(f"{minutes} minute{'s' if minutes != 1 else ''}")
    return ' '.join(parts)

