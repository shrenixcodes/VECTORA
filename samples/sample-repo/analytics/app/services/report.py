"""Report generation."""
from ..models import Event

MAX_ROWS = 500


def summarize(rows):
    """Counts events per kind."""
    counts = {}
    for row in rows:
        counts[row.kind] = counts.get(row.kind, 0) + 1
    return counts


class ReportService:
    """Builds usage reports from recorded events."""

    def __init__(self, session):
        self.session = session

    def build_report(self):
        rows = self.session.query(Event).limit(MAX_ROWS).all()
        return summarize(rows)

    def record(self, kind):
        self.session.add(Event(kind=kind))
        self.missing_helper()
