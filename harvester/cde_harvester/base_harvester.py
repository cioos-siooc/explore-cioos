from abc import ABC, abstractmethod
from dataclasses import dataclass
import logging

import pandas as pd
from pandera.typing import DataFrame

from cde_harvester.schemas import (
    DatasetSchema,
    ProfileSchema,
    SkippedDatasetSchema,
    VariableSchema,
)

logger = logging.getLogger(__name__)


@dataclass
class HarvestResult:
    """Standardized output for all harvesters."""

    profiles: DataFrame[ProfileSchema]
    datasets: DataFrame[DatasetSchema]
    variables: DataFrame[VariableSchema]
    skipped: DataFrame[SkippedDatasetSchema]

    def validate(self):
        """Validate all DataFrames against their schemas.

        Logs warnings on validation failure rather than raising,
        so existing workflows aren't broken during transition.
        """
        for name, schema in [
            ("profiles", ProfileSchema),
            ("datasets", DatasetSchema),
            ("variables", VariableSchema),
            ("skipped", SkippedDatasetSchema),
        ]:
            df = getattr(self, name)
            try:
                schema.validate(df)
            except Exception as e:
                logger.warning("Schema validation failed for %s: %s", name, e)


class BaseHarvester(ABC):
    """Abstract base class for CDE harvesters.

    All harvesters must implement the harvest() method which returns
    a HarvestResult containing the harvested DataFrames.
    """

    @abstractmethod
    def harvest(self) -> HarvestResult:
        """Execute the harvest process.

        Returns:
            HarvestResult: The harvested data.
        """
        pass
