"""
Logging utilities for integrating Sentry and Prefect logging.
"""
import logging
import os
from typing import Optional

from prefect import get_run_logger
from prefect.context import FlowRunContext, TaskRunContext
import sentry_sdk
from sentry_sdk.integrations.logging import LoggingIntegration


class SentryPrefectHandler(logging.Handler):
    """
    Custom logging handler that routes messages to both Sentry and Prefect.
    
    When running inside a Prefect flow/task, messages are sent to Prefect's logger.
    Messages at WARNING level and above are also sent to Sentry.
    When not in a Prefect context, behaves like a standard handler.
    """
    
    def __init__(self, level=logging.NOTSET):
        super().__init__(level)
        self._prefect_logger = None
        self._in_prefect_context = False
        self._in_emit = False  # Recursion guard
        
    def _get_prefect_logger(self):
        """Try to get the Prefect logger if in a flow/task context."""
        try:
            # Check if we're in a Prefect context
            flow_context = FlowRunContext.get()
            task_context = TaskRunContext.get()
            
            if flow_context or task_context:
                self._in_prefect_context = True
                return get_run_logger()
        except Exception:
            pass
        
        self._in_prefect_context = False
        return None
    
    def emit(self, record):
        """
        Emit a log record to both Prefect (if available) and Sentry (for warnings+).
        """
        # Prevent recursive logging
        if self._in_emit:
            return
            
        try:
            self._in_emit = True
            
            # Skip Prefect's own log messages to avoid loops
            if record.name.startswith('prefect'):
                return
            
            # Get Prefect logger (cached within the same context)
            if self._prefect_logger is None or not self._in_prefect_context:
                self._prefect_logger = self._get_prefect_logger()
            
            # Format the message
            msg = self.format(record)
            
            # Send to Prefect if in a flow/task context
            if self._prefect_logger:
                # Map log levels to Prefect logger methods
                # Don't pass extra to avoid LogRecord key conflicts
                if record.levelno >= logging.ERROR:
                    self._prefect_logger.error(msg)
                elif record.levelno >= logging.WARNING:
                    self._prefect_logger.warning(msg)
                elif record.levelno >= logging.INFO:
                    self._prefect_logger.info(msg)
                else:
                    self._prefect_logger.debug(msg)
            
            # Sentry integration handles WARNING+ automatically via LoggingIntegration
            # but we can add additional context if needed
            if record.levelno >= logging.WARNING:
                with sentry_sdk.push_scope() as scope:
                    scope.set_context("log_record", {
                        "logger_name": record.name,
                        "pathname": record.pathname,
                        "lineno": record.lineno,
                        "funcName": record.funcName,
                    })
                    
                    if record.exc_info:
                        sentry_sdk.capture_exception(record.exc_info[1])
                        
        except Exception:
            self.handleError(record)
        finally:
            self._in_emit = False


def setup_integrated_logger(
    name: Optional[str] = None,
    level: str = "INFO",
    log_format: Optional[str] = None,
    include_console: bool = True,
    file_handler: Optional[logging.FileHandler] = None,
) -> logging.Logger:
    """
    Set up a logger that integrates with both Sentry and Prefect.
    
    Args:
        name: Logger name. If None, returns root logger.
        level: Logging level (DEBUG, INFO, WARNING, ERROR, CRITICAL)
        log_format: Custom log format string. If None, uses default.
        include_console: Whether to include console output
        file_handler: Optional file handler to add to the logger
        
    Returns:
        Configured logger instance
        
    Example:
        >>> logger = setup_integrated_logger("my_app", level="DEBUG")
        >>> logger.info("This goes to console, Prefect (if in flow), and Sentry breadcrumbs")
        >>> logger.warning("This goes to console, Prefect, and Sentry as an event")
    """
    logger = logging.getLogger(name)
    logger.setLevel(logging.getLevelName(level.upper()))
    logger.handlers.clear()
    
    # Define log format
    if log_format is None:
        log_format = "%(asctime)s - %(levelname)-8s - %(name)s : %(message)s"
    
    formatter = logging.Formatter(log_format)
    
    # Add console handler if requested
    if include_console:
        console_handler = logging.StreamHandler()
        console_handler.setLevel(logging.getLevelName(level.upper()))
        console_handler.setFormatter(formatter)
        logger.addHandler(console_handler)
    
    # Add file handler if provided
    if file_handler:
        file_handler.setLevel(logging.getLevelName(level.upper()))
        file_handler.setFormatter(formatter)
        logger.addHandler(file_handler)
    
    # Add the integrated Sentry/Prefect handler
    integrated_handler = SentryPrefectHandler(level=logging.getLevelName(level.upper()))
    integrated_handler.setFormatter(formatter)
    logger.addHandler(integrated_handler)
    
    return logger


def initialize_sentry(
    dsn: Optional[str] = None,
    environment: Optional[str] = None,
    info_breadcrumbs: bool = True,
    warning_events: bool = True,
) -> None:
    """
    Initialize Sentry SDK with logging integration.
    
    Args:
        dsn: Sentry DSN. If None, reads from SENTRY_DSN environment variable
        environment: Environment name. If None, reads from ENVIRONMENT env var
        info_breadcrumbs: Capture INFO+ logs as breadcrumbs
        warning_events: Send WARNING+ logs as events
    """
    dsn = dsn or os.environ.get("SENTRY_DSN")
    environment = environment or os.environ.get("ENVIRONMENT", "development")
    
    sentry_sdk.init(
        dsn=dsn,
        integrations=[
            LoggingIntegration(
                level=logging.INFO if info_breadcrumbs else logging.WARNING,
                event_level=logging.WARNING if warning_events else logging.ERROR,
            ),
        ],
        environment=environment,
        # Optionally add Prefect-specific tags
        before_send=_add_prefect_context,
    )


def _add_prefect_context(event, hint):
    """Add Prefect context information to Sentry events."""
    try:
        flow_context = FlowRunContext.get()
        if flow_context:
            event.setdefault("tags", {})
            event["tags"]["prefect_flow_run_id"] = str(flow_context.flow_run.id)
            event["tags"]["prefect_flow_name"] = flow_context.flow.name
            
        task_context = TaskRunContext.get()
        if task_context:
            event.setdefault("tags", {})
            event["tags"]["prefect_task_run_id"] = str(task_context.task_run.id)
            event["tags"]["prefect_task_name"] = task_context.task.name
    except Exception:
        pass
    
    return event
