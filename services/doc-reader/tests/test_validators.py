from datetime import date

from docreader.validators import (
    is_valid_cnh_number,
    is_valid_cpf,
    is_valid_renavam,
    mask_cpf,
    normalize_plate,
    parse_br_date,
)


def test_cpf():
    assert is_valid_cpf("529.982.247-25")
    assert not is_valid_cpf("529.982.247-24")
    assert not is_valid_cpf("111.111.111-11")
    assert not is_valid_cpf("123")


def test_plate():
    assert normalize_plate("abc-1234") == "ABC1234"
    assert normalize_plate("BRA 2E19") == "BRA2E19"
    assert normalize_plate("AB12345") is None


def test_renavam():
    assert not is_valid_renavam("12345")


def test_renavam_digito_verificador():
    # Monta um RENAVAM válido pela regra (pesos 3,2,9,8,7,6,5,4,3,2) e depois estraga o último dígito.
    base = "0063936437"
    weights = [3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    dv = (sum(int(c) * w for c, w in zip(base, weights)) * 10) % 11 % 10
    assert is_valid_renavam(base + str(dv))
    assert not is_valid_renavam(base + str((dv + 1) % 10))


def test_cnh_number():
    # 02650306461 é o exemplo clássico de CNH válida usado em documentação pública de validação.
    assert is_valid_cnh_number("02650306461")
    assert not is_valid_cnh_number("02650306462")
    assert not is_valid_cnh_number("11111111111")


def test_dates_and_mask():
    assert parse_br_date("29/02/2024") == date(2024, 2, 29)
    assert parse_br_date("29/02/2023") is None
    assert parse_br_date("lixo") is None
    assert mask_cpf("52998224725") == "***.982.247-**"
