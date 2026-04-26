import sys
import os

project_home = os.path.dirname(os.path.abspath(__file__))
if project_home not in sys.path:
    sys.path.insert(0, project_home)

os.chdir(project_home)

from a2wsgi import ASGIMiddleware
from main import app as fastapi_app

application = ASGIMiddleware(fastapi_app)
