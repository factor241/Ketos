from ketos.api.v1.api_key import router as api_key_router
from ketos.api.v1.authz_audit import router as authz_audit_router
from ketos.api.v1.authz_me import router as authz_me_router
from ketos.api.v1.authz_role_assignments import router as authz_role_assignments_router
from ketos.api.v1.authz_roles import router as authz_roles_router
from ketos.api.v1.authz_shares import router as authz_shares_router
from ketos.api.v1.authz_teams import router as authz_teams_router
from ketos.api.v1.board_automation_runs import router as board_automation_runs_router
from ketos.api.v1.board_notes import router as board_notes_router
from ketos.api.v1.boards import router as boards_router
from ketos.api.v1.chat import router as chat_router
from ketos.api.v1.chat_threads import router as chat_threads_router
from ketos.api.v1.command_proposals import router as command_proposals_router
from ketos.api.v1.endpoints import router as endpoints_router
from ketos.api.v1.extensions import router as extensions_router
from ketos.api.v1.files import router as files_router
from ketos.api.v1.flow_events import router as flow_events_router
from ketos.api.v1.flow_version import router as flow_version_router
from ketos.api.v1.flows import router as flows_router
from ketos.api.v1.folders import router as folders_router
from ketos.api.v1.knowledge_bases import router as knowledge_bases_router
from ketos.api.v1.login import router as login_router
from ketos.api.v1.mcp import router as mcp_router
from ketos.api.v1.mcp_projects import router as mcp_projects_router
from ketos.api.v1.memories import router as memories_router
from ketos.api.v1.model_options import router as model_options_router
from ketos.api.v1.models import router as models_router
from ketos.api.v1.monitor import router as monitor_router
from ketos.api.v1.openai_responses import router as openai_responses_router
from ketos.api.v1.placements import router as placements_router
from ketos.api.v1.projects import router as projects_router
from ketos.api.v1.starter_projects import router as starter_projects_router
from ketos.api.v1.store import router as store_router
from ketos.api.v1.traces import router as traces_router
from ketos.api.v1.users import router as users_router
from ketos.api.v1.validate import router as validate_router
from ketos.api.v1.variable import router as variables_router
from ketos.api.v1.voice_mode import router as voice_mode_router

__all__ = [
    "api_key_router",
    "authz_audit_router",
    "authz_me_router",
    "authz_role_assignments_router",
    "authz_roles_router",
    "authz_shares_router",
    "authz_teams_router",
    "board_automation_runs_router",
    "board_notes_router",
    "boards_router",
    "chat_router",
    "chat_threads_router",
    "command_proposals_router",
    "endpoints_router",
    "extensions_router",
    "files_router",
    "flow_events_router",
    "flow_version_router",
    "flows_router",
    "folders_router",
    "knowledge_bases_router",
    "login_router",
    "mcp_projects_router",
    "mcp_router",
    "memories_router",
    "model_options_router",
    "models_router",
    "monitor_router",
    "openai_responses_router",
    "placements_router",
    "projects_router",
    "starter_projects_router",
    "store_router",
    "traces_router",
    "users_router",
    "validate_router",
    "variables_router",
    "voice_mode_router",
]
