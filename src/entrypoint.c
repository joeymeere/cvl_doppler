#define CVL_NO_SYSTEM
#define CVL_NO_TOKEN
#define CVL_NO_HEAP

#include <caravel.h>
#include "state.h"

#define ADMIN_HEADER  0x0008
#define ADMIN_KEY     0x0010

#define NO_DUP_SIGNER ((uint16_t)(0x01 << 8 | 0xFF))

#define ORACLE_SEQUENCE 0x28C0
#define ORACLE_PAYLOAD  0x28C8

/* pos shifts w/ payload size */
#define IX_SEQUENCE (0x50D8 + sizeof(PriceFeed))
#define IX_PAYLOAD  (0x50E0 + sizeof(PriceFeed))

#ifndef DOPPLER_ADMIN_KEY
#define DOPPLER_ADMIN_KEY \
    0x12, 0xcc, 0x99, 0x34, 0x4f, 0x73, 0xbf, 0x60, \
    0xe1, 0x24, 0x97, 0xfa, 0xaf, 0xe6, 0x52, 0x54, \
    0xe6, 0x00, 0x3a, 0xa3, 0x11, 0xe7, 0xf4, 0xcf, \
    0xb7, 0x86, 0x25, 0xab, 0xc0, 0x1d, 0x60, 0x84
#endif

static const uint8_t ADMIN[CVL_PUBKEY_SIZE] = { DOPPLER_ADMIN_KEY };

static void process(const uint8_t *_input) {
    uint8_t *input = (uint8_t *)_input;

    /* signer + no-dup marker */
    if (*(uint16_t *)(input + ADMIN_HEADER) != NO_DUP_SIGNER)
        CVL_EXIT(1);

    if (*(uint64_t *)(input + ADMIN_KEY)        != *(uint64_t *)(ADMIN))
        CVL_EXIT(1);
    if (*(uint64_t *)(input + ADMIN_KEY + 0x08) != *(uint64_t *)(ADMIN + 8))
        CVL_EXIT(1);
    if (*(uint64_t *)(input + ADMIN_KEY + 0x10) != *(uint64_t *)(ADMIN + 16))
        CVL_EXIT(1);
    if (*(uint64_t *)(input + ADMIN_KEY + 0x18) != *(uint64_t *)(ADMIN + 24))
        CVL_EXIT(1);

    uint64_t current_seq = *(uint64_t *)(input + ORACLE_SEQUENCE);
    uint64_t new_seq     = *(uint64_t *)(input + IX_SEQUENCE);

    /* seq must be strictly increasing!!!!!! */
    if (new_seq <= current_seq)
        CVL_EXIT(2);

    *(uint64_t *)(input + ORACLE_SEQUENCE)  = new_seq;
    *(PriceFeed *)(input + ORACLE_PAYLOAD)  = *(PriceFeed *)(input + IX_PAYLOAD);
}

CVL_RAW_ENTRYPOINT(process)
