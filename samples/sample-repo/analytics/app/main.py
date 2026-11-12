"""Analytics service entry point."""
from fastapi import FastAPI

from .services.report import ReportService
from . import models

app = FastAPI()


def get_session():
    return None


@app.get("/stats")
def stats():
    """Returns the usage report."""
    service = ReportService(get_session())
    return service.build_report()


@app.post("/events")
def record_event(kind: str):
    ReportService(get_session()).record(kind)
    undefined_function(kind)
    return {"ok": True}
