"""MongoRepo against a real MongoDB, only if PIANO_TEST_MONGODB_URI is set (it uses a throwaway database)."""

import os
import uuid

import pytest

from pianocore.mongo_repo import MongoRepo

from .test_repos import check_repo_contract

URI = os.environ.get("PIANO_TEST_MONGODB_URI")


@pytest.mark.skipif(not URI, reason="set PIANO_TEST_MONGODB_URI to test against MongoDB")
async def test_mongo_contract(keys):
    name = "piano_test_" + uuid.uuid4().hex[:8]
    repo = MongoRepo.connect(URI, keys, db_name=name)
    try:
        await repo.ensure_indexes()
        await check_repo_contract(repo)
        doc = await repo.db.melodies.find_one({})
        assert b"60:0:1" not in bytes(doc["data"])  # stored encrypted
    finally:
        await repo.client.drop_database(name)
        await repo.client.close()
