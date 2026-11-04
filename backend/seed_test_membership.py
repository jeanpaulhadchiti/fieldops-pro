
from sqlalchemy import select

from app.models import User, Organization, Membership


def seed_membership(db):
    user = db.scalar(
        select(User).where(
            User.email == "testuser@example.com"
        )
    )

    organization = db.scalar(
        select(Organization).where(
            Organization.name == "Demo Scout Group"
        )
    )

    if user is None or organization is None:
        print("User or organization not found.")

    else:
        existing = db.scalar(
            select(Membership).where(
                Membership.user_id == user.id,
                Membership.organization_id == organization.id
            )
        )

        if existing:
            print("Membership already exists.")

        else:
            membership = Membership(
                user_id=user.id,
                organization_id=organization.id,
                role="Owner"
            )

            db.add(membership)
            db.commit()

            print("Membership created successfully!")
            print("User:", user.name)
            print("Organization:", organization.name)
            print("Role:", membership.role)


def main():
    from app.database import SessionLocal

    with SessionLocal() as db:
        seed_membership(db)


if __name__ == "__main__":
    main()
