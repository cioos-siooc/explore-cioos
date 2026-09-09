import os
import smtplib
from email.message import EmailMessage

from loguru import logger

from cde_common.env import load_env

envs = os.environ

# Not behind an `if not os.getenv("GMAIL_USER")` sentinel any more: guessing at
# one variable to decide whether the whole file had been supplied meant a
# container that set DB_HOST but no GMAIL_* loaded the .env for the database and
# not for the mail settings. load_env() searches once per working directory, so
# calling it unconditionally costs nothing.
load_env()


def send_email(mail_to, mail_message_body, mail_subject):
    if "GMAIL_USER" not in envs:
        logger.error("GMAIL auth not configured")
        return
    logger.debug("Emailing: {}", mail_to)
    gmail_user = envs["GMAIL_USER"]
    if not gmail_user:
        logger.error("GMAIL_USER not set")
        return
    gmail_password = envs["GMAIL_PASSWORD"]

    msg = EmailMessage()
    msg["Subject"] = mail_subject
    msg["From"] = gmail_user
    msg["To"] = mail_to
    msg.set_content(mail_message_body)

    try:
        s = smtplib.SMTP_SSL("smtp.gmail.com", 465)
        s.login(gmail_user, gmail_password)
        s.send_message(msg)
        s.quit()
    except smtplib.SMTPAuthenticationError:
        # loguru's logger.error treats its first arg as a format string, so
        # passing the exception object raised AttributeError. Use logger.exception
        # to log the message + traceback correctly.
        logger.exception("SMTP authentication failed for {}", gmail_user)
